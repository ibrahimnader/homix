/**
 * Re-prices old vendor invoices that were issued before the current settlement model
 * (reference model: Homix delivery vendorDue = cost gross, vendor delivery balance = collection - cost - shipping,
 * fines as their own column, signed net = vendorDue - companyDue - fines).
 *
 * For each target invoice it runs the SAME steps a user would run in the UI, through the
 * same service, so every rule and audit event applies:
 *   transferred -> reviewed   (clears the transfer date/amount; the old values are kept in the audit event)
 *   frozen      -> reviewed
 *   reviewed    -> draft      (refused by the service when a receipt is uploaded)
 *   draft refresh             (re-runs the report for that vendor/cycle; manual overrides, line states and
 *                              adjustments are preserved)
 * The invoice ends as a DRAFT with the refreshed numbers; review and transfer it again from the UI.
 *
 *   npm run db:refresh-old-invoices                                   # preview (default, nothing is written)
 *   npm run db:refresh-old-invoices -- --apply --actor=<user id>      # apply to the listed invoices
 *   npm run db:refresh-old-invoices -- --code=INV-2026-0001,INV-2026-0002 --apply --actor=<id>
 *
 * Options:
 *   --status=transferred,reviewed,frozen   which statuses to include (default: transferred)
 *   --code=INV-...                         restrict to these invoice codes
 *   --actor=<id>                           user recorded in the audit log (required with --apply)
 *   --apply                                actually write
 *
 * Invoices with an uploaded receipt are SKIPPED and listed: remove the receipt in the UI first
 * (that is a business decision, the script never deletes receipts).
 */
import { QueryTypes } from "sequelize";

import { connectToDb, sequelize } from "../infrastructure/database";
import { InvoiceRepository } from "../modules/financial-invoices/invoice.repo";
import { InvoiceService } from "../modules/financial-invoices/invoice.service";
import { OrderRepository } from "../modules/orders/order.repo";

const apply = process.argv.includes("--apply");
const arg = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

type Row = {
  code: string | null;
  hasReceipt: boolean;
  id: number;
  netAmount: string | null;
  periodEnd: string;
  status: string;
  transferAmount: string | null;
  vendorId: number;
  vendorName: string | null;
};

const STATUSES = new Set(["transferred", "reviewed", "frozen"]);

const main = async (): Promise<void> => {
  const statuses = (arg("status") ?? "transferred").split(",").map((value) => value.trim()).filter(Boolean);
  for (const status of statuses) {
    if (!STATUSES.has(status)) throw new Error(`--status must be a list of: ${[...STATUSES].join(", ")}`);
  }
  const codes = (arg("code") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const actorId = Number(arg("actor"));
  if (apply && (!Number.isInteger(actorId) || actorId <= 0)) {
    throw new Error("--apply needs --actor=<user id> (recorded in the audit log)");
  }

  await connectToDb();

  if (apply) {
    const found = await sequelize.query<{ id: number }>("SELECT id FROM users WHERE id = :id LIMIT 1", {
      replacements: { id: actorId }, type: QueryTypes.SELECT,
    });
    if (!found.length) throw new Error(`--actor=${actorId} is not a user`);
  }

  const rows = await sequelize.query<Row>(
    `SELECT i.id, i.code, i."vendorId", v.name AS "vendorName", i.status, i."periodEnd",
            i."netAmount"::text AS "netAmount", i."transferAmount"::text AS "transferAmount",
            (i."receiptPath" IS NOT NULL) AS "hasReceipt"
       FROM financial_invoices i
       LEFT JOIN vendors v ON v.id = i."vendorId"
      WHERE i.status IN (:statuses) ${codes.length ? "AND i.code IN (:codes)" : ""}
      ORDER BY i."periodEnd", i.id`,
    { replacements: { codes, statuses }, type: QueryTypes.SELECT },
  );

  // eslint-disable-next-line no-console
  console.log(`${apply ? "APPLY" : "PREVIEW (nothing is written)"} — ${rows.length} invoice(s) with status ${statuses.join("/")}\n`);

  const orderRepository = new OrderRepository();
  const service = new InvoiceService({
    getReport: (query, vendorId) => orderRepository.getFinancialReport(query, vendorId),
    repo: new InvoiceRepository(),
  });

  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const label = `${row.code ?? `#${row.id}`} · ${row.vendorName ?? row.vendorId} · cycle end ${String(row.periodEnd).slice(0, 10)} · ${row.status} · net ${row.netAmount}` +
      (row.transferAmount !== null ? ` · transferred ${row.transferAmount}` : "");

    if (row.hasReceipt) {
      skipped += 1;
      // eslint-disable-next-line no-console
      console.log(`  SKIP (receipt uploaded — remove it first): ${label}`);
      continue;
    }
    if (!apply) {
      // eslint-disable-next-line no-console
      console.log(`  would revert to draft and refresh: ${label}`);
      continue;
    }

    try {
      const actor = { id: actorId };
      if (row.status === "transferred") await service.transition(row.id, "reviewed", {}, actor);
      if (row.status === "frozen") await service.transition(row.id, "reviewed", {}, actor);
      await service.transition(row.id, "draft", {}, actor);
      await service.refreshDraft(row.id, actor);
      const after = await sequelize.query<{ netAmount: string; status: string }>(
        `SELECT "netAmount"::text AS "netAmount", status FROM financial_invoices WHERE id = :id`,
        { replacements: { id: row.id }, type: QueryTypes.SELECT },
      );
      done += 1;
      // eslint-disable-next-line no-console
      console.log(`  OK: ${label}\n      -> now ${after[0]?.status}, net ${after[0]?.netAmount}`);
    } catch (error) {
      failed += 1;
      const current = await sequelize.query<{ status: string }>(
        `SELECT status FROM financial_invoices WHERE id = :id`, { replacements: { id: row.id }, type: QueryTypes.SELECT },
      );
      // eslint-disable-next-line no-console
      console.log(`  FAILED (invoice is now ${current[0]?.status}): ${label}\n      ${error instanceof Error ? error.message : error}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(apply
    ? `\nDone: ${done} refreshed, ${skipped} skipped (receipt), ${failed} failed.`
    : `\nPreview: ${rows.length - skipped} would be refreshed, ${skipped} skipped (receipt). Re-run with --apply --actor=<user id>.`);
};

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Refresh failed");
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => undefined);
  });
