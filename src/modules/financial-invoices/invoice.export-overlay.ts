import { invoiceStatusLabel, LINE_STATE, type InvoiceStatus, type LineState } from "./invoice.constants";
import { fromCents, toCents } from "./invoice.money";
import type { OrderFinancialReportOrderRow, OrderFinancialReportResponse, OrderFinancialReportSectionSummary, OrderFinancialReportVendorRow } from "../orders/order.types";

/**
 * Excel export = the same numbers as the screen: the live report with the cycle's invoices laid over it
 * (backend twin of the frontend `liveOverlay.ts`). Pure functions; the service feeds them the invoice rows.
 */

export const LINE_STATE_LABELS: Record<LineState, string> = {
  deferred: "مؤجل",
  frozen: "مجمّد",
  included: "محسوب",
  removed: "محذوف",
};

export const MANUAL_EDIT_LABEL = "تعديل يدوي";

export type OverlayLine = {
  orderId: number;
  isWarehouseDelivery: boolean;
  outsideCycle: boolean;
  state: LineState;
  /** effective (override-aware) amounts, as `toLineDto` computes them */
  collectionTotal: number; companyDue: number; fines: number; vendorDue: number; vendorShippingCost: number; warehouseCost: number;
  /** presence of an override per field (decides live vs invoice value; never printed for vendors) */
  collectionOverridden: boolean; companyDueOverridden: boolean; finesOverridden: boolean; vendorDueOverridden: boolean;
  vendorShippingOverridden: boolean; warehouseCostOverridden: boolean;
  /** vendor-visible columns of a line that exists only in the invoice (outside the report window) */
  operationNumber: string; orderNumber: string; productCode: string; paymentStatus: number | null; paymentStatusLabel: string;
  companyDueKind: "margin" | "vendorOwes";
  /** staff only: why it was overridden / handled */
  reason: string | null;
};

export type OverlayAdjustment = { label: string; kind: "addition" | "deduction"; amount: number };

export type OverlayInvoice = {
  id: number; vendorId: number; code: string | null; status: InvoiceStatus;
  adjustmentsTotal: number; netAmount: number;
  adjustments: OverlayAdjustment[];
  lines: OverlayLine[];
  /** ids of counted orders (state = included) */
  includedOrderIds: number[];
};

export type ExportOrder = {
  orderId: number; operationNumber: string; orderNumber: string; productCode: string; paymentStatusLabel: string;
  isWarehouseDelivery: boolean; companyDueKind: "margin" | "vendorOwes";
  collectionTotal: number; warehouseCost: number; vendorShippingCost: number; fines: number; vendorDue: number; companyDue: number;
  state: LineState | "live";
  /** cells replaced by an invoice override, e.g. ["fines"] (empty for vendors and for lines without overrides) */
  overridden: string[];
  note: string | null;
};

export type ExportVendorRow = OrderFinancialReportVendorRow & {
  exportOrders: ExportOrder[];
  invoice: { code: string | null; status: InvoiceStatus; statusLabel: string; adjustmentsTotal: number; netAmount: number; adjustments: OverlayAdjustment[] } | null;
};
export type ExportSection = { items: ExportVendorRow[]; summary: OrderFinancialReportSectionSummary };
export type ExportReport = Omit<OrderFinancialReportResponse, "fullInvoice" | "vendorDeliveries" | "warehouseDeliveries"> & {
  fullInvoice: ExportSection; vendorDeliveries: ExportSection; warehouseDeliveries: ExportSection;
};

type TabKey = "comprehensive" | "seller" | "warehouse";
const OVERRIDE_FIELD_LABELS: Array<[keyof OverlayLine, string, string]> = [
  ["collectionOverridden", "collectionTotal", "التحصيل"],
  ["warehouseCostOverridden", "warehouseCost", "سعر التكلفة"],
  ["vendorShippingOverridden", "vendorShippingCost", "شحن البائع"],
  ["finesOverridden", "fines", "الغرامات"],
  ["vendorDueOverridden", "vendorDue", "مستحق البائع"],
  ["companyDueOverridden", "companyDue", "المستحق لهوميكس"],
];

const sum = (values: number[]): number => fromCents(values.reduce((total, value) => total + toCents(value), 0));
const companyDueKindOf = (order: { companyDueKind?: "margin" | "vendorOwes"; shipmentId?: number | null }): "margin" | "vendorOwes" =>
  order.companyDueKind ?? (order.shipmentId != null ? "margin" : "vendorOwes");

const baseOrder = (order: OrderFinancialReportOrderRow): ExportOrder => ({
  collectionTotal: order.collectionTotal, companyDue: order.companyDue, companyDueKind: companyDueKindOf(order), fines: order.fines,
  isWarehouseDelivery: order.shipmentId != null, note: null, operationNumber: order.operationNumber, orderId: order.orderId,
  orderNumber: order.orderNumber, overridden: [], paymentStatusLabel: order.paymentStatusLabel, productCode: order.productCode,
  state: "live", vendorDue: order.vendorDue, vendorShippingCost: order.vendorShippingCost, warehouseCost: order.warehouseCost,
});

const overrideInfo = (line: OverlayLine, isVendor: boolean): { overridden: string[]; note: string | null } => {
  if (isVendor) return { note: null, overridden: [] };
  const labels = OVERRIDE_FIELD_LABELS.filter(([flag]) => line[flag]);
  const parts: string[] = [];
  if (labels.length) parts.push(`${MANUAL_EDIT_LABEL}: ${labels.map(([, , label]) => label).join("، ")}`);
  if (line.state !== LINE_STATE.INCLUDED) parts.push(`${LINE_STATE_LABELS[line.state]} — غير محسوب في الفاتورة`);
  if (line.reason && parts.length) parts.push(line.reason);
  return { note: parts.length ? parts.join(" — ") : null, overridden: labels.map(([, key]) => key) };
};

const fromLine = (line: OverlayLine, isVendor: boolean): ExportOrder => ({
  collectionTotal: line.collectionTotal, companyDue: line.companyDue, companyDueKind: line.companyDueKind, fines: line.fines,
  isWarehouseDelivery: line.isWarehouseDelivery, operationNumber: line.operationNumber, orderId: line.orderId, orderNumber: line.orderNumber,
  paymentStatusLabel: line.paymentStatusLabel, productCode: line.productCode, state: line.state, vendorDue: line.vendorDue,
  vendorShippingCost: line.vendorShippingCost, warehouseCost: line.warehouseCost, ...overrideInfo(line, isVendor),
});

export const isCountedOrder = (order: Pick<ExportOrder, "state">): boolean => order.state === "live" || order.state === LINE_STATE.INCLUDED;

const recompute = (row: OrderFinancialReportVendorRow, orders: ExportOrder[]): OrderFinancialReportVendorRow => {
  const counted = orders.filter(isCountedOrder);
  const pick = (get: (order: ExportOrder) => number) => sum(counted.map(get));
  return {
    ...row,
    collectionTotal: pick((o) => o.collectionTotal),
    // مستحق هوميكس = بنود تسليم البائع فقط (vendorOwes)؛ تسليم المخزن لا يُحتسب
    companyDue: pick((o) => (o.companyDueKind === "vendorOwes" ? o.companyDue : 0)),
    fines: pick((o) => o.fines),
    // signed per-row net (reference model): Σ vendorDue (gross) − Σ companyDue (vendor deliveries) − Σ fines
    netAmount: pick((o) => o.vendorDue - (o.companyDueKind === "vendorOwes" ? o.companyDue : 0) - o.fines),
    ordersCount: counted.length,
    vendorDue: pick((o) => o.vendorDue),
    vendorOwes: pick((o) => (o.companyDueKind === "vendorOwes" ? o.companyDue : 0)),
    vendorShippingCost: pick((o) => o.vendorShippingCost),
    warehouseCost: pick((o) => o.warehouseCost),
  };
};

const extraBelongsToTab = (tab: TabKey, line: OverlayLine): boolean =>
  tab === "comprehensive" || (tab === "warehouse" ? line.isWarehouseDelivery : !line.isWarehouseDelivery);

function overlayVendor(tab: TabKey, row: OrderFinancialReportVendorRow, invoices: OverlayInvoice[], isVendor: boolean): ExportVendorRow {
  const invoice = invoices.find((item) => item.vendorId === row.vendorId) ?? null;
  const live = row.orders.map(baseOrder);
  if (!invoice) return { ...row, exportOrders: live, invoice: null };

  const byOrder = new Map(invoice.lines.map((line) => [line.orderId, line]));
  const included = new Set(invoice.includedOrderIds);
  let changed = false;
  const orders: ExportOrder[] = [];
  row.orders.forEach((order, index) => {
    const line = byOrder.get(order.orderId);
    const liveOrder = live[index]!;
    if (!line && !included.has(order.orderId)) {
      // in the live cycle but not on the invoice at all
      changed = true;
      if (!isVendor) orders.push({ ...liveOrder, note: "غير مضمّن في الفاتورة", state: "removed" });
      return;
    }
    if (line && line.state !== LINE_STATE.INCLUDED) {
      changed = true;
      if (!isVendor) orders.push({ ...liveOrder, ...overrideInfo(line, isVendor), state: line.state });
      return;
    }
    if (!line) { orders.push(liveOrder); return; }
    changed = true;
    orders.push({
      ...liveOrder,
      // cost / collection / shipping follow the invoice only when overridden there (same as the screen)
      collectionTotal: line.collectionOverridden ? line.collectionTotal : liveOrder.collectionTotal,
      companyDue: line.companyDue,
      fines: line.fines,
      state: LINE_STATE.INCLUDED,
      vendorDue: line.vendorDue,
      vendorShippingCost: line.vendorShippingOverridden ? line.vendorShippingCost : liveOrder.vendorShippingCost,
      warehouseCost: line.warehouseCostOverridden ? line.warehouseCost : liveOrder.warehouseCost,
      ...overrideInfo(line, isVendor),
    });
  });

  const present = new Set(orders.map((order) => order.orderId));
  for (const line of invoice.lines) {
    if (!line.outsideCycle || line.state !== LINE_STATE.INCLUDED || present.has(line.orderId) || !extraBelongsToTab(tab, line)) continue;
    changed = true;
    orders.push(fromLine(line, isVendor));
  }

  return {
    ...(changed ? recompute(row, orders) : row),
    exportOrders: orders,
    invoice: {
      adjustments: invoice.adjustments, adjustmentsTotal: invoice.adjustmentsTotal, code: invoice.code, netAmount: invoice.netAmount,
      status: invoice.status, statusLabel: invoiceStatusLabel(invoice.status, invoice.netAmount),
    },
  };
}

const SUMMARY_KEYS = ["collectionTotal", "companyDue", "fines", "netAmount", "ordersCount", "vendorDue", "vendorOwes", "vendorShippingCost", "warehouseCost"] as const;

const sectionSum = (rows: OrderFinancialReportVendorRow[], key: (typeof SUMMARY_KEYS)[number]): number => sum(rows.map((row) => Number(row[key]) || 0));

/** Section summary = live summary + (overlaid rows − live rows), exactly like the screen's KPI delta. */
function overlaySection(tab: TabKey, section: OrderFinancialReportResponse["fullInvoice"], invoices: OverlayInvoice[], isVendor: boolean): ExportSection {
  const items = section.items.map((row) => overlayVendor(tab, row, invoices, isVendor));
  const summary = { ...section.summary };
  for (const key of SUMMARY_KEYS) {
    summary[key] = key === "ordersCount"
      ? section.summary[key] + (sectionSum(items, key) - sectionSum(section.items, key))
      : fromCents(toCents(section.summary[key]) + toCents(sectionSum(items, key)) - toCents(sectionSum(section.items, key)));
  }
  return { items, summary };
}

export function overlayReport(report: OrderFinancialReportResponse, invoices: OverlayInvoice[], isVendor: boolean): ExportReport {
  const fullInvoice = overlaySection("comprehensive", report.fullInvoice, invoices, isVendor);
  const vendorDeliveries = overlaySection("seller", report.vendorDeliveries, invoices, isVendor);
  const warehouseDeliveries = overlaySection("warehouse", report.warehouseDeliveries, invoices, isVendor);
  const delta = (key: (typeof SUMMARY_KEYS)[number]) => toCents(sectionSum(fullInvoice.items, key)) - toCents(sectionSum(report.fullInvoice.items, key));
  return {
    ...report,
    fullInvoice,
    summary: {
      ...report.summary,
      companyDue: fromCents(toCents(report.summary.companyDue) + delta("companyDue")),
      fines: fromCents(toCents(report.summary.fines) + delta("fines")),
      netAmount: fromCents(toCents(report.summary.netAmount) + delta("netAmount")),
      totalSales: fromCents(toCents(report.summary.totalSales) + delta("collectionTotal")),
      vendorDue: fromCents(toCents(report.summary.vendorDue) + delta("vendorDue")),
      vendorOwes: fromCents(toCents(report.summary.vendorOwes) + delta("vendorOwes")),
    },
    vendorDeliveries,
    warehouseDeliveries,
  };
}

/** Live report without any invoice: same shape, nothing overlaid. */
export const liveExportReport = (report: OrderFinancialReportResponse): ExportReport => overlayReport(report, [], false);
