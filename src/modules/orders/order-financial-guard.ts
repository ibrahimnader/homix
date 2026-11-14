import { ForbiddenError } from "../../shared/errors";
import { PAYMENT_STATUS, USER_TYPES } from "../../../config/constants";
import { toNumber } from "./order.helpers";

/**
 * Order financial fields may only be changed by an admin or a non-vendor user
 * holding `orders_edit_financials`. Vendors never may, whatever their permission
 * map says. A field that is sent but equals the stored value is not a change
 * (the full edit forms re-send every field). One helper serves the order routes
 * and the shipment routes so the rule cannot drift.
 */
export const ORDER_FINANCIAL_EDIT_PERMISSION = "orders_edit_financials";

/** Fields guarded on the order update / bulk-update routes. */
export const ORDER_FINANCIAL_FIELDS = [
  "costPrice",
  "shippingFees",
  "totalDiscounts",
  "downPayment",
  "totalPrice",
  "subTotalPrice",
  "toBeCollected",
  "totalCost",
] as const;

/** Fields guarded on the shipment routes. `receivedAmount` is deliberately not
 *  here: the Accounts page edits it under the finance permissions. */
export const SHIPMENT_FINANCIAL_FIELDS = ["costPrice", "shippingFees", "totalDiscounts", "downPayment"] as const;

type GuardUser = { permissions?: unknown; userType?: unknown } | null | undefined;

/** Money equality tolerant to "100.00" vs 100 and decimal noise. */
const sameAmount = (left: unknown, right: unknown): boolean => Math.abs(toNumber(left) - toNumber(right)) < 0.005;

export const canEditOrderFinancials = (user: GuardUser): boolean => {
  if (String(user?.userType) === String(USER_TYPES.VENDOR)) return false;
  if (String(user?.userType) === String(USER_TYPES.ADMIN)) return true;
  const permissions = user?.permissions as Record<string, unknown> | undefined;
  return Boolean(permissions && typeof permissions === "object" && permissions[ORDER_FINANCIAL_EDIT_PERMISSION]);
};

const isUnchanged = (field: string, value: unknown, existing: Record<string, unknown>): boolean => {
  if (sameAmount(value, existing[field])) return true;
  /* The order list shows «المطلوب تحصيله» as 0 for paid orders although the
     column keeps the old figure; the legacy edit modal re-sends what it shows. */
  if (field === "toBeCollected" && toNumber(existing.paymentStatus) === PAYMENT_STATUS.PAID && sameAmount(value, 0)) {
    return true;
  }
  return false;
};

/**
 * Throws ForbiddenError when a user without the permission changes a guarded
 * field. `existing` = stored row (single update); without it (bulk) any guarded
 * field present counts as a change. `costPrice` has no stored column (it is
 * spread over order lines), so it counts whenever it is sent; forms must only
 * send it after the user edited it.
 */
export const assertFinancialEditAllowed = (
  payload: Record<string, unknown>,
  user: GuardUser,
  existing?: Record<string, unknown> | null,
  fields: readonly string[] = ORDER_FINANCIAL_FIELDS,
): void => {
  if (canEditOrderFinancials(user)) return;
  const changed = fields.some((field) => {
    if (!(field in payload) || payload[field] === undefined) return false;
    if (!existing || field === "costPrice") return true;
    return !isUnchanged(field, payload[field], existing);
  });
  if (changed) throw new ForbiddenError("ليس لديك صلاحية تعديل التفاصيل المالية للطلب");
};
