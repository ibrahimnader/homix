import { MANUFACTURE_STATUS_ARABIC, ORDER_STATUS, ORDER_STATUS_Arabic } from "../../../config/constants";
import { SHIPMENT_STATUS_LABELS } from "../shipments/shipment.constants";
import { deriveStatusPatch } from "./order-status-sync";

/**
 * Regression safety net for the order edit endpoints (single + bulk).
 *
 * The status sync lets an explicit status change drive the other linked columns even backwards (manufacture 2 on a delivered
 * order -> order 2). To stop that happening by accident, an edit that would move a delivered / returned / replaced /
 * in-inventory order, or an order sitting on a reviewed / frozen / transferred financial invoice, to an EARLIER state is
 * refused with 409 `REGRESSION_NEEDS_CONFIRMATION` unless the request carries `confirmRegression: true`.
 * Vendors can never confirm: they are refused with 403 `REGRESSION_FORBIDDEN`.
 */
export const CONFIRM_REGRESSION_FIELD = "confirmRegression";
export const REGRESSION_NEEDS_CONFIRMATION_CODE = "REGRESSION_NEEDS_CONFIRMATION";
export const REGRESSION_FORBIDDEN_CODE = "REGRESSION_FORBIDDEN";
export const REGRESSION_AUDIT_ACTION = "regression_confirmed";

export type RegressionField = "status" | "shipmentStatus" | "manufactureStatus";
export type RegressionReason =
  | "delivered" | "returned" | "replaced" | "in_inventory"
  | "invoice_reviewed" | "invoice_frozen" | "invoice_transferred";
export type RegressionChange = {
  field: RegressionField;
  fieldLabel: string;
  from: number;
  fromLabel: string;
  to: number;
  toLabel: string;
  /** "explicit" = sent in the request; "derived" = written by the status sync. */
  origin: "explicit" | "derived";
};
export type OrderRegression = {
  orderId: number;
  orderNumber: string;
  reasons: RegressionReason[];
  reasonLabels: string[];
  changes: RegressionChange[];
};

/** Progress rank per column (higher = further along). Cancel/reject variants and anything unlisted rank -1. */
const STATUS_RANK: Readonly<Record<number, number>> = { 1: 0, 3: 1, 2: 2, 8: 3, 5: 4, 6: 5, 7: 6 };
const SHIPMENT_RANK: Readonly<Record<number, number>> = { 1: 0, 11: 1, 3: 2, 12: 3, 10: 3, 2: 4, 4: 5, 7: 6, 9: 7 };
const MANUFACTURE_RANK: Readonly<Record<number, number>> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 3, 7: 4, 6: 5, 17: 6, 18: 7 };
const RANKS: Readonly<Record<RegressionField, Readonly<Record<number, number>>>> = {
  status: STATUS_RANK, shipmentStatus: SHIPMENT_RANK, manufactureStatus: MANUFACTURE_RANK,
};
const FIELD_LABEL: Readonly<Record<RegressionField, string>> = {
  status: "حالة الطلب", shipmentStatus: "حالة الشحنة", manufactureStatus: "حالة التصنيع",
};
const REGRESSION_FIELDS: readonly RegressionField[] = ["status", "shipmentStatus", "manufactureStatus"];

const FINAL_STATUS_REASON: Readonly<Record<number, RegressionReason>> = {
  [ORDER_STATUS.DELIVERED]: "delivered", [ORDER_STATUS.REFUNDED]: "returned",
  [ORDER_STATUS.REPLACED]: "replaced", [ORDER_STATUS.IN_INVENTORY]: "in_inventory",
};
const REASON_LABEL: Readonly<Record<RegressionReason, string>> = {
  delivered: "الطلب تم تسليمه", returned: "الطلب مسترجع", replaced: "الطلب مستبدل", in_inventory: "الطلب في المخزن",
  invoice_reviewed: "الطلب على فاتورة مالية تمت مراجعتها", invoice_frozen: "الطلب على فاتورة مالية مجمّدة",
  invoice_transferred: "الطلب على فاتورة مالية تم تحويلها",
};
const INVOICE_REASON: Readonly<Record<string, RegressionReason>> = {
  reviewed: "invoice_reviewed", frozen: "invoice_frozen", transferred: "invoice_transferred",
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const labelOf = (field: RegressionField, value: number): string => {
  const table = field === "status" ? ORDER_STATUS_Arabic
    : field === "manufactureStatus" ? MANUFACTURE_STATUS_ARABIC
      : (SHIPMENT_STATUS_LABELS as Record<number, string>);
  return String((table as Record<number, string>)[value] ?? value);
};
const plain = (row: unknown): Record<string, unknown> => {
  const candidate = row as { toJSON?: () => Record<string, unknown> } | null | undefined;
  return (typeof candidate?.toJSON === "function" ? candidate.toJSON() : candidate) ?? {};
};

/** Reasons that come from the stored order status alone (no invoice lookup needed). */
export const finalStatusReasons = (before: unknown): RegressionReason[] => {
  const reason = FINAL_STATUS_REASON[toNumberOrNull(plain(before).status) ?? -1];
  return reason ? [reason] : [];
};

/** Backwards moves of status / shipmentStatus / manufactureStatus that `payload` causes on `before`, explicit and derived. */
export const detectRegressiveChanges = (before: unknown, payload: Record<string, unknown>): RegressionChange[] => {
  const stored = plain(before);
  const { patch } = deriveStatusPatch(stored, payload);
  const changes: RegressionChange[] = [];
  for (const field of REGRESSION_FIELDS) {
    const explicit = toNumberOrNull(payload[field]);
    const derivedValue = patch[field];
    const from = toNumberOrNull(stored[field]);
    const explicitChanged = explicit !== null && explicit !== from;
    const to = explicitChanged ? explicit : derivedValue ?? null;
    if (to === null || from === null || to === from) continue;
    const fromRank = RANKS[field][from];
    if (fromRank === undefined) continue;
    const toRank = RANKS[field][to] ?? -1;
    if (toRank >= fromRank) continue;
    changes.push({
      field, fieldLabel: FIELD_LABEL[field], from, fromLabel: labelOf(field, from), to, toLabel: labelOf(field, to),
      origin: explicitChanged ? "explicit" : "derived",
    });
  }
  return changes;
};

export const invoiceReasons = (statuses: ReadonlyArray<string>): RegressionReason[] =>
  [...new Set(statuses.map((status) => INVOICE_REASON[status]).filter((reason): reason is RegressionReason => Boolean(reason)))];

/**
 * Orders (stored rows) whose edit would regress them. `lookupInvoiceStatuses` is only called for orders that have a
 * regressive change and are not already final by status, so edits without regressions never touch the invoice tables.
 */
export const findOrderRegressions = async (
  orders: ReadonlyArray<unknown>,
  payload: Record<string, unknown>,
  lookupInvoiceStatuses: (orderIds: number[]) => Promise<Map<number, string[]>>,
): Promise<OrderRegression[]> => {
  const candidates = orders
    .map((order) => ({ order: plain(order), changes: detectRegressiveChanges(order, payload) }))
    .filter((entry) => entry.changes.length > 0);
  if (candidates.length === 0) return [];
  const needInvoice = candidates.filter((entry) => finalStatusReasons(entry.order).length === 0).map((entry) => Number(entry.order.id));
  const invoices = needInvoice.length > 0 ? await lookupInvoiceStatuses(needInvoice) : new Map<number, string[]>();
  const regressions: OrderRegression[] = [];
  for (const { order, changes } of candidates) {
    const orderId = Number(order.id);
    const reasons = [...finalStatusReasons(order), ...invoiceReasons(invoices.get(orderId) ?? [])];
    if (reasons.length === 0) continue;
    regressions.push({
      orderId, orderNumber: String(order.orderNumber ?? orderId), reasons, reasonLabels: reasons.map((reason) => REASON_LABEL[reason]), changes,
    });
  }
  return regressions;
};

export const buildRegressionMessage = (regressions: ReadonlyArray<OrderRegression>): string => {
  const lines = regressions.map((entry) => {
    const changes = entry.changes.map((change) => `${change.fieldLabel}: ${change.fromLabel} ← ${change.toLabel}`).join("، ");
    return `الطلب ${entry.orderNumber} (${entry.reasonLabels.join(" / ")}): ${changes}`;
  });
  return `هذا التعديل سيُرجع حالة ${regressions.length === 1 ? "طلب" : `${regressions.length} طلبات`} إلى حالة سابقة:\n${lines.join("\n")}\nللمتابعة أعد الإرسال مع تأكيد الرجوع (confirmRegression: true).`;
};

export const buildRegressionAuditEntry = (regression: OrderRegression): { field: string; from: string; to: string } => ({
  field: "regression",
  from: regression.changes.map((change) => `${change.field}:${change.from}`).join(","),
  to: regression.changes.map((change) => `${change.field}:${change.to}`).join(","),
});
