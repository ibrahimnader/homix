/**
 * Backfills vendor settlement invoices (draft) for billing cycles that already closed.
 *
 * Nothing generates invoices automatically when a cycle ends, so the archive only
 * holds what someone issued with «إصدار فواتير الدورة». This script issues the
 * missing ones in bulk by calling the same service as POST /financial-invoices/generate,
 * so every rule applies: closed cycles only, one invoice per vendor per cycle, orders
 * that already sit on an invoice are never added twice, re-running is safe.
 *
 *   npm run db:backfill-financial-invoices -- --from=2026-01-01              # preview (default)
 *   npm run db:backfill-financial-invoices -- --from=2026-01-01 --actor=1 --apply
 *
 * --from   first day to cover; every closed cycle whose END date is on/after it is included
 *          (default: January 1st of the current year, Cairo time).
 * --to     last day to cover (default: today).
 * --actor  user id recorded as the creator in the audit log; required with --apply.
 * --apply  actually create the drafts. Without it nothing is written.
 *
 * Cycles: billing day 13 covers the 29th of the previous month through the 13th,
 * billing day 28 covers the 14th through the 28th (end of day, Cairo time).
 * Created invoices are DRAFTS holding a snapshot of each order as the live report
 * computes it today; they are not reviewed, frozen or marked transferred.
 */
import moment from "moment-timezone";
import { QueryTypes } from "sequelize";

import { connectToDb, sequelize } from "../infrastructure/database";
import { InvoiceRepository } from "../modules/financial-invoices/invoice.repo";
import { InvoiceService } from "../modules/financial-invoices/invoice.service";
import { OrderRepository } from "../modules/orders/order.repo";

const TZ = "Africa/Cairo";
const apply = process.argv.includes("--apply");

const arg = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];

const clampDay = (month: moment.Moment, day: number): moment.Moment =>
  month.clone().date(Math.min(day, month.daysInMonth())).endOf("day");

type Cycle = { billingDay: 13 | 28; end: moment.Moment };

/** Every cycle whose end falls in [from, to] and has already closed. */
const listCycles = (from: moment.Moment, to: moment.Moment): Cycle[] => {
  const cycles: Cycle[] = [];
  const now = moment().tz(TZ);
  for (let month = from.clone().startOf("month"); month.isSameOrBefore(to, "month"); month.add(1, "month")) {
    for (const billingDay of [13, 28] as const) {
      const end = clampDay(month, billingDay);
      if (end.isBefore(from, "day") || end.isAfter(to, "day")) continue;
      if (!end.isBefore(now)) continue; // still open: the service refuses it too
      cycles.push({ billingDay, end });
    }
  }
  return cycles;
};

const main = async (): Promise<void> => {
  const from = moment.tz(arg("from") ?? `${moment().tz(TZ).year()}-01-01`, "YYYY-MM-DD", true, TZ);
  const to = arg("to") ? moment.tz(arg("to") as string, "YYYY-MM-DD", true, TZ) : moment().tz(TZ);
  if (!from.isValid() || !to.isValid()) throw new Error("--from / --to must be YYYY-MM-DD");

  const actorId = Number(arg("actor"));
  if (apply && (!Number.isInteger(actorId) || actorId <= 0)) {
    throw new Error("--apply needs --actor=<user id> (recorded in the audit log)");
  }

  await connectToDb();

  if (apply) {
    const rows = await sequelize.query<{ id: number }>(
      'SELECT id FROM users WHERE id = :id LIMIT 1',
      { replacements: { id: actorId }, type: QueryTypes.SELECT },
    );
    if (!rows.length) throw new Error(`--actor=${actorId} is not a user`);
  }

  const orderRepository = new OrderRepository();
  const service = new InvoiceService({
    getReport: (query, vendorId) => orderRepository.getFinancialReport(query, vendorId),
    repo: new InvoiceRepository(),
  });

  const cycles = listCycles(from, to);
  // eslint-disable-next-line no-console
  console.log(`${apply ? "APPLY" : "PREVIEW (nothing is written)"} — ${cycles.length} closed cycle(s) from ${from.format("YYYY-MM-DD")} to ${to.format("YYYY-MM-DD")}\n`);

  let totalCreated = 0;
  let totalOrders = 0;
  for (const cycle of cycles) {
    const referenceDate = cycle.end.format("YYYY-MM-DD");
    const label = `cycle ending ${referenceDate} (billing day ${cycle.billingDay})`;

    if (!apply) {
      const report = await orderRepository.getFinancialReport({ billingDay: cycle.billingDay, referenceDate }, null);
      const vendors = report.fullInvoice.items.filter((item: { vendorId?: unknown }) => item.vendorId);
      const orders = vendors.reduce((sum: number, item: { orders: unknown[] }) => sum + item.orders.length, 0);
      totalOrders += orders;
      // eslint-disable-next-line no-console
      console.log(`  ${label}: ${vendors.length} vendor(s), ${orders} order(s)`);
      continue;
    }

    const result = await service.generate({ billingDay: cycle.billingDay, referenceDate }, { id: actorId });
    const created = result.invoices.filter((invoice) => invoice.created).length;
    const added = result.invoices.reduce((sum, invoice) => sum + invoice.added, 0);
    totalCreated += created;
    totalOrders += added;
    // eslint-disable-next-line no-console
    console.log(`  ${label}: ${created} invoice(s) created, ${added} order line(s) added, ${result.invoices.length - created} already existed`);
  }

  // eslint-disable-next-line no-console
  console.log(apply
    ? `\nDone: ${totalCreated} draft invoice(s) created, ${totalOrders} order line(s).`
    : `\nPreview total: ${totalOrders} order(s) across ${cycles.length} cycle(s). Re-run with --actor=<user id> --apply to create the drafts.`);
};

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Backfill failed");
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => undefined);
  });
