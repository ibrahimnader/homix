import { Op, col, fn, where } from "sequelize";

/**
 * «رقم الطلب» search is an EXACT match, never a substring one: searching 1373
 * must not return #2373 or 11373. The stored value comes in several shapes
 * (`1373`, `#1373`, `H1373`, in `name`/`orderNumber`), so both
 * sides are compared after dropping whitespace and a leading `#` and ignoring
 * case. `H1373` therefore only matches `H1373`/`#H1373`, not `1373`.
 */
export const normalizeOrderNumberSearch = (value: unknown): string =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/^#+/, "")
    .toLowerCase();

/**
 * `orderNumber` is the number shown in the «رقم الطلب» column; `name` carries the full Shopify-style name
 * (`#HX1278`), so typing the full name works too. The legacy `number` column is deliberately NOT searched:
 * it holds unrelated values (e.g. order #2278 stores number 1278) and made a search for 1278 return #2278.
 */
const ORDER_NUMBER_COLUMNS = ["Order.name", "Order.orderNumber"] as const;

/** Sequelize condition matching the order number exactly; `null` when the search is empty. */
export const buildOrderNumberCondition = (value: unknown): Record<PropertyKey, unknown> | null => {
  const normalized = normalizeOrderNumberSearch(value);
  if (!normalized) return null;

  return {
    [Op.or]: ORDER_NUMBER_COLUMNS.map((column) =>
      where(
        fn("lower", fn("regexp_replace", fn("btrim", col(column)), "^#+", "")),
        { [Op.eq]: normalized },
      ),
    ),
  };
};
