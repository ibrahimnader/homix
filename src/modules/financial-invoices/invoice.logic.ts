import {
  ALLOWED_TRANSITIONS, INVOICE_STATUS, LINE_STATE, OVERDUE_DAYS,
  type InvoiceStatus,
} from "./invoice.constants";
import { fromCents, toCents } from "./invoice.money";
import type { AdjustmentRow, InvoiceRow, InvoiceTotals, LineRow, LineSnapshot } from "./invoice.types";

const optionalCents = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : toCents(value);

type EffectiveInput = Pick<LineRow, "fines" | "vendorDue" | "companyDue" | "finesOverride" | "vendorDueOverride" | "companyDueOverride">
  & Partial<Pick<LineRow, "warehouseCostOverride" | "vendorShippingCostOverride" | "collectionOverride" | "collectionTotal" | "warehouseCost" | "vendorShippingCost" | "companyDueKind" | "isWarehouseDelivery">>;

/**
 * Effective (override-aware) per-line amounts in piasters. Reference model (owner decision, Nov 2026):
 *  cost / collection / vendor shipping / fines = override ?? snapshot
 *  Homix delivery (kind `margin`)   : vendorDue = cost (GROSS, before fines), companyDue = 0 (the snapshot is the report's value;
 *                                     a cost override re-derives it)
 *  vendor delivery (kind `vendorOwes`): balance = collection − cost − shipping;
 *                                       balance >= 0 → companyDue = balance, else vendorDue = −balance
 *                                       (no cost/collection/shipping override → the snapshot dues, which are the report's)
 *  vendorDue  = vendorDueOverride  ?? derived   (a GROSS vendor due)
 *  companyDue = companyDueOverride ?? derived
 * Fines are their own column: they never alter vendorDue / companyDue and are subtracted once from the net.
 */
export const effectiveLineCents = (line: EffectiveInput) => {
  const fines = toCents(line.fines);
  const finesOverride = optionalCents(line.finesOverride);
  const costOverride = optionalCents(line.warehouseCostOverride);
  const collectionOverride = optionalCents(line.collectionOverride);
  const shippingOverride = optionalCents(line.vendorShippingCostOverride);
  const vendorDueOverride = optionalCents(line.vendorDueOverride);
  const companyDueOverride = optionalCents(line.companyDueOverride);
  const effectiveFines = finesOverride ?? fines;
  const cost = costOverride ?? toCents(line.warehouseCost);
  const collection = collectionOverride ?? toCents(line.collectionTotal);
  // override replaces the system value; vendorShippingCost may be absent on partial inputs
  const shipping = shippingOverride ?? toCents(line.vendorShippingCost ?? 0);
  const homixDelivery = !countsTowardCompanyDue(line);

  let derivedVendorDue: number;
  let derivedCompanyDue: number;
  if (homixDelivery) {
    // a cost override re-derives the gross due; otherwise the snapshot (the report's value) stands
    derivedVendorDue = costOverride !== null ? cost : toCents(line.vendorDue);
    derivedCompanyDue = costOverride !== null ? 0 : toCents(line.companyDue);
  } else if (costOverride !== null || collectionOverride !== null || shippingOverride !== null) {
    const balance = collection - cost - shipping;
    derivedCompanyDue = Math.max(balance, 0);
    derivedVendorDue = Math.max(-balance, 0);
  } else {
    derivedCompanyDue = toCents(line.companyDue);
    derivedVendorDue = toCents(line.vendorDue);
  }
  return {
    collection,
    companyDue: companyDueOverride ?? derivedCompanyDue,
    cost,
    fines: effectiveFines,
    shipping,
    vendorDue: vendorDueOverride ?? derivedVendorDue,
  };
};

/** «مستحق هوميكس» يخصّ بنود تسليم البائع فقط؛ البند بلا نوع يُحسب بحسب isWarehouseDelivery (مخزن = لا يُحتسب). */
export const countsTowardCompanyDue = (line: { companyDueKind?: "margin" | "vendorOwes" | null; isWarehouseDelivery?: boolean | null }): boolean =>
  (line.companyDueKind ?? (line.isWarehouseDelivery ? "margin" : "vendorOwes")) === "vendorOwes";

/** Signed line net in piasters: vendorDue − companyDue (vendor deliveries only) − fines. */
export const lineNetCents = (line: EffectiveInput): number => {
  const effective = effectiveLineCents(line);
  return effective.vendorDue - (countsTowardCompanyDue(line) ? effective.companyDue : 0) - effective.fines;
};

export const computeTotals = (
  lines: Array<Pick<LineRow, "state" | "fines" | "vendorDue" | "companyDue" | "finesOverride" | "vendorDueOverride" | "companyDueOverride" | "collectionTotal" | "warehouseCost" | "vendorShippingCost"> & Partial<Pick<LineRow, "warehouseCostOverride" | "vendorShippingCostOverride" | "collectionOverride" | "companyDueKind" | "isWarehouseDelivery">>>,
  adjustments: Array<Pick<AdjustmentRow, "kind" | "amount" | "removedAt">>,
): InvoiceTotals => {
  let ordersCount = 0;
  let collection = 0; let warehouse = 0; let shipping = 0; let fines = 0; let vendorDue = 0; let companyDue = 0;
  for (const line of lines) {
    if (line.state !== LINE_STATE.INCLUDED) continue;
    const effective = effectiveLineCents(line);
    ordersCount += 1;
    collection += effective.collection;
    warehouse += effective.cost;
    shipping += effective.shipping;
    fines += effective.fines;
    vendorDue += effective.vendorDue;
    if (countsTowardCompanyDue(line)) companyDue += effective.companyDue;
  }
  const adjustmentsCents = sumAdjustmentCents(adjustments);
  return {
    adjustmentsTotal: fromCents(adjustmentsCents),
    collectionTotal: fromCents(collection),
    companyDueTotal: fromCents(companyDue),
    finesTotal: fromCents(fines),
    // signed: > 0 Homix owes the vendor, < 0 the vendor owes Homix, 0 settled
    netAmount: fromCents(vendorDue - companyDue - fines + adjustmentsCents),
    ordersCount,
    vendorDueTotal: fromCents(vendorDue),
    vendorShippingCost: fromCents(shipping),
    warehouseCost: fromCents(warehouse),
  };
};

function sumAdjustmentCents(adjustments: Array<Pick<AdjustmentRow, "kind" | "amount" | "removedAt">>): number {
  return adjustments.reduce((sum, adjustment) => {
    if (adjustment.removedAt) return sum;
    const cents = toCents(adjustment.amount);
    return sum + (adjustment.kind === "addition" ? cents : -cents);
  }, 0);
}

export const canTransition = (from: InvoiceStatus, to: InvoiceStatus): boolean =>
  ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;

const toMs = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** Whole days since review, excluding frozen time; stops at transfer/freeze. */
export const daysCounter = (
  invoice: Pick<InvoiceRow, "status" | "reviewedAt" | "frozenAt" | "transferredAt" | "frozenDurationMs">,
  now: number = Date.now(),
): number | null => {
  const reviewed = toMs(invoice.reviewedAt);
  if (reviewed === null || invoice.status === INVOICE_STATUS.DRAFT) return null;
  const end = invoice.status === INVOICE_STATUS.TRANSFERRED
    ? toMs(invoice.transferredAt) ?? now
    : invoice.status === INVOICE_STATUS.FROZEN
      ? toMs(invoice.frozenAt) ?? now
      : now;
  const elapsed = Math.max(0, end - reviewed - Math.max(0, Number(invoice.frozenDurationMs) || 0));
  return Math.floor(elapsed / 86_400_000);
};

export const isOverdue = (
  invoice: Pick<InvoiceRow, "status" | "reviewedAt" | "frozenAt" | "transferredAt" | "frozenDurationMs">,
  now: number = Date.now(),
): boolean => invoice.status === INVOICE_STATUS.REVIEWED && (daysCounter(invoice, now) ?? 0) > OVERDUE_DAYS;

/** Maps one order row of the live report to a line snapshot. */
export const snapshotFromReportOrder = (order: {
  orderId?: number; id?: number; operationNumber?: string; orderNumber?: string; productCode?: string;
  paymentStatus?: number | null; paymentStatusLabel?: string; shipmentId?: number | null;
  collectionTotal?: number; warehouseCost?: number; fines?: number; vendorShippingCost?: number;
  vendorDue?: number; companyDue?: number; companyDueKind?: "margin" | "vendorOwes";
}): LineSnapshot => {
  const isWarehouseDelivery = order.shipmentId !== null && order.shipmentId !== undefined;
  return {
    collectionTotal: fromCents(toCents(order.collectionTotal)),
    companyDue: fromCents(toCents(order.companyDue)),
    companyDueKind: order.companyDueKind ?? null,
    fines: fromCents(toCents(order.fines)),
    isWarehouseDelivery,
    operationNumber: String(order.operationNumber ?? ""),
    orderId: Number(order.orderId ?? order.id),
    orderNumber: String(order.orderNumber ?? ""),
    paymentStatus: order.paymentStatus ?? null,
    paymentStatusLabel: String(order.paymentStatusLabel ?? ""),
    productCode: String(order.productCode ?? ""),
    // vendor shipping only applies to vendor deliveries (same rule as the report totals)
    vendorDue: fromCents(toCents(order.vendorDue)),
    vendorShippingCost: isWarehouseDelivery ? 0 : fromCents(toCents(order.vendorShippingCost)),
    warehouseCost: fromCents(toCents(order.warehouseCost)),
  };
};

/** Derived from the sign of the net: vendor (Homix pays him), homix (the vendor owes Homix), null (settled). */
export const dueParty = (netAmount: number): "vendor" | "homix" | null => (netAmount > 0 ? "vendor" : netAmount < 0 ? "homix" : null);
