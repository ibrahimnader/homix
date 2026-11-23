/**
 * يملأ «المحافظة» للطلبات القديمة من عنوان العميل.
 *
 * New orders resolve their governorate at creation (order.service.js), but rows
 * created before that shipped have the column empty, so the new column in the
 * orders table and the governorate filter show nothing for them.
 *
 * Only blank governorates are touched — an existing value is never overwritten,
 * whether it was typed by hand or picked from the bulk edit. Addresses that
 * match no governorate closely enough are counted and left alone rather than
 * guessed at.
 *
 * Dry-run by default; pass `--apply` to write. `--months=N` limits it to orders created in the
 * last N months (calendar months back from now); without it every order is considered.
 *
 *   npm run db:backfill-order-governorate                            # عرض فقط
 *   npm run db:backfill-order-governorate -- --months=3              # عرض آخر 3 شهور فقط
 *   npm run db:backfill-order-governorate -- --months=3 --apply      # تنفيذ لآخر 3 شهور
 */
import { QueryTypes } from "sequelize";

import { sequelize } from "../infrastructure/database/sequelize";
import { matchGovernorate } from "../shared/governorate/governorate.resolver";

const apply = process.argv.includes("--apply");

/** `--months=N` (positive integer) → only orders created within the last N months; null = all orders. */
const parseMonths = (argv: string[]): number | null => {
  const raw = argv.find((value) => value.startsWith("--months="))?.split("=")[1];
  if (raw === undefined) return null;
  const months = Number(raw);
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    throw new Error("--months must be a whole number between 1 and 120");
  }
  return months;
};
const months = parseMonths(process.argv);

/* NOTE: this script deliberately does NOT touch "updatedAt". The financial report places a delivered order in a cycle
   by coalesce(deliveryDate, updatedAt); bumping updatedAt here pulled old delivered orders (no deliveryDate) into the
   current cycle's invoices. */

/** حجم الدفعة — يبقي الترانزاكشن قصيراً على قاعدة بيانات بعيدة. */
const BATCH_SIZE = 500;

type OrderAddressRow = {
  address: string | null;
  id: number;
};

export type GovernorateBackfillResult = {
  matched: number;
  scanned: number;
  unmatched: number;
  /** كم طلباً لكل محافظة — للمراجعة قبل التنفيذ. */
  byGovernorate: Record<string, number>;
};

export const backfillOrderGovernorate = async (): Promise<GovernorateBackfillResult> => {
  const result: GovernorateBackfillResult = {
    byGovernorate: {},
    matched: 0,
    scanned: 0,
    unmatched: 0,
  };

  let lastId = 0;

  for (;;) {
    const rows = await sequelize.query<OrderAddressRow>(
      `
        SELECT o.id, c.address
        FROM orders o
        JOIN customers c ON c.id = o."customerId" AND c."deletedAt" IS NULL
        WHERE o."deletedAt" IS NULL
          AND nullif(btrim(coalesce(o.governorate, '')), '') IS NULL
          AND nullif(btrim(coalesce(c.address, '')), '') IS NOT NULL
          AND o.id > :lastId
          ${months === null ? "" : `AND o."createdAt" >= NOW() - make_interval(months => ${months})`}
        ORDER BY o.id
        LIMIT :batchSize
      `,
      { replacements: { batchSize: BATCH_SIZE, lastId }, type: QueryTypes.SELECT },
    );

    if (rows.length === 0) {
      break;
    }

    const idsByGovernorate = new Map<string, number[]>();

    for (const row of rows) {
      result.scanned += 1;
      lastId = row.id;

      const match = matchGovernorate(row.address);
      if (!match || match.governorateId === null) {
        result.unmatched += 1;
        continue;
      }

      result.matched += 1;
      result.byGovernorate[match.label] = (result.byGovernorate[match.label] ?? 0) + 1;

      const key = String(match.governorateId);
      idsByGovernorate.set(key, [...(idsByGovernorate.get(key) ?? []), row.id]);
    }

    if (apply) {
      // one UPDATE per governorate per batch instead of one per order (remote DB round trips dominate)
      for (const [governorate, ids] of idsByGovernorate) {
        await sequelize.query(
          `
            UPDATE orders
            SET governorate = :governorate
            WHERE id IN (:ids)
              AND nullif(btrim(coalesce(governorate, '')), '') IS NULL
          `,
          { replacements: { governorate, ids }, type: QueryTypes.UPDATE },
        );
      }
    }
  }

  return result;
};

const run = async (): Promise<void> => {
  const result = await backfillOrderGovernorate();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", months, ...result }, null, 2));
};

if (require.main === module) {
  run()
    .catch((error: Error) => {
      // eslint-disable-next-line no-console
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}
