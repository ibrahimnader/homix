/**
 * «أخطاء وتصحيحات»: pure detection over SAVED invoices (draft/reviewed/frozen/transferred).
 * No IO here: the repo loads the rows, this file only decides what is wrong.
 */
import { LINE_STATE, type InvoiceStatus } from "./invoice.constants";
import { isHomixDelivery, notBillableReason } from "./invoice.eligibility";
import { computeTotals, countsTowardCompanyDue, effectiveLineCents } from "./invoice.logic";
import { toCents } from "./invoice.money";
import type { AdjustmentRow, InvoiceRow, LineRow } from "./invoice.types";


export type IssueSeverity = "error" | "warning";
export const ISSUE_TYPES = [
  "cross_vendor", "dup_in_invoice", "dup_cross_cycle", "dup_same_cycle",
  "missing_operation", "both_dues", "order_changed", "net_drift",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  both_dues: "مستحق للشركة والبائع معًا",
  cross_vendor: "نفس العملية عند أكتر من بائع",
  dup_cross_cycle: "نزلت في أكتر من تقفيلة",
  dup_in_invoice: "عملية مكررة في نفس الفاتورة",
  dup_same_cycle: "نفس العملية في فاتورتين بنفس التقفيلة",
  missing_operation: "بند بدون رقم عملية",
  net_drift: "صافي الفاتورة لا يطابق البنود",
  order_changed: "الطلب اتغيّر بعد الفوترة",
};

const SEVERITY: Record<IssueType, IssueSeverity> = {
  both_dues: "warning", cross_vendor: "error", dup_cross_cycle: "error", dup_in_invoice: "error", dup_same_cycle: "error",
  missing_operation: "warning", net_drift: "error", order_changed: "warning",
};

export type IssueInvoice = Pick<InvoiceRow, "id" | "code" | "vendorId" | "status" | "periodEnd" | "netAmount" | "billingDay"> & { vendorName?: string | null };
export type IssueLine = Pick<LineRow, "id" | "invoiceId" | "orderId" | "operationNumber" | "orderNumber" | "state" | "isWarehouseDelivery"
  | "fines" | "vendorDue" | "companyDue" | "finesOverride" | "vendorDueOverride" | "companyDueOverride" | "collectionTotal" | "warehouseCost" | "vendorShippingCost">
  & Partial<Pick<LineRow, "warehouseCostOverride" | "vendorShippingCostOverride" | "collectionOverride" | "companyDueKind">>;
export type LiveOrder = { deletedAt?: Date | string | null; deliveryBy?: number | null; shipmentStatus?: number | null; status?: number | null };

export type IssueOccurrence = {
  invoiceCode: string | null; invoiceId: number; invoiceStatus: InvoiceStatus; lineId: number | null; orderId: number | null;
  periodEnd: string | null; vendorId: number; vendorName: string;
};

export type InvoiceIssue = {
  details: string;
  id: string;
  occurrences: IssueOccurrence[];
  operationNumber: string;
  orderId: number | null;
  orderNumber: string;
  severity: IssueSeverity;
  type: IssueType;
  typeLabel: string;
  vendorId: number;
  vendorName: string;
};

export type DetectInput = {
  adjustments: Array<Pick<AdjustmentRow, "invoiceId" | "kind" | "amount" | "removedAt">>;
  /** invoices whose own checks (drift, per-line) run; other invoices only take part in duplicate grouping */
  invoices: IssueInvoice[];
  lines: IssueLine[];
  orders: Map<number, LiveOrder>;
  scopeInvoiceIds: Set<number>;
};

const isoDay = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const operationKey = (line: IssueLine): string => String(line.operationNumber ?? "").trim();
const isCounted = (line: IssueLine): boolean => line.state === LINE_STATE.INCLUDED || line.state === LINE_STATE.FROZEN;

/** Warehouse delivery = delivered by Homix (a billable Homix delivery also has its shipment delivered). */
export const isLiveDeliveryWarehouse = (order: LiveOrder): boolean => isHomixDelivery(order.deliveryBy);

export const detectInvoiceIssues = (input: DetectInput): InvoiceIssue[] => {
  const invoiceById = new Map(input.invoices.map((invoice) => [Number(invoice.id), invoice]));
  const issues: InvoiceIssue[] = [];

  const occurrenceOf = (line: IssueLine | null, invoice: IssueInvoice): IssueOccurrence => ({
    invoiceCode: invoice.code ?? null,
    invoiceId: Number(invoice.id),
    invoiceStatus: invoice.status,
    lineId: line ? Number(line.id) : null,
    orderId: line ? Number(line.orderId) : null,
    periodEnd: isoDay(invoice.periodEnd),
    vendorId: Number(invoice.vendorId),
    vendorName: invoice.vendorName ?? "",
  });
  const push = (type: IssueType, key: string, base: { details: string; line: IssueLine | null; occurrences: IssueOccurrence[]; vendor: IssueInvoice }) => {
    const { line, vendor } = base;
    issues.push({
      details: base.details,
      id: `${type}:${key}`,
      occurrences: base.occurrences,
      operationNumber: line ? operationKey(line) : "",
      orderId: line ? Number(line.orderId) : null,
      orderNumber: line ? String(line.orderNumber ?? "") : "",
      severity: SEVERITY[type],
      type,
      typeLabel: ISSUE_TYPE_LABELS[type],
      vendorId: Number(vendor.vendorId),
      vendorName: vendor.vendorName ?? "",
    });
  };

  /* ---- duplicates (1-4): group counted lines by operation number ---- */
  const groups = new Map<string, Array<{ invoice: IssueInvoice; line: IssueLine }>>();
  for (const line of input.lines) {
    if (!isCounted(line)) continue;
    const invoice = invoiceById.get(Number(line.invoiceId));
    const key = operationKey(line);
    if (!invoice || !key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push({ invoice, line });
    groups.set(key, bucket);
  }
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    // a group only matters when it touches an invoice we are asked to review
    if (!members.some((member) => input.scopeInvoiceIds.has(Number(member.invoice.id)))) continue;
    const occurrences = (list: typeof members) => list.map((member) => occurrenceOf(member.line, member.invoice));

    const vendors = new Set(members.map((member) => Number(member.invoice.vendorId)));
    if (vendors.size > 1) {
      const names = [...new Set(members.map((member) => member.invoice.vendorName || `#${member.invoice.vendorId}`))].join(" / ");
      push("cross_vendor", key, { details: `العملية ${key} موجودة على فواتير بائعين مختلفين: ${names}`, line: members[0]!.line, occurrences: occurrences(members), vendor: members[0]!.invoice });
    }
    const byVendor = new Map<number, typeof members>();
    for (const member of members) {
      const list = byVendor.get(Number(member.invoice.vendorId)) ?? [];
      list.push(member);
      byVendor.set(Number(member.invoice.vendorId), list);
    }
    for (const [vendorId, own] of byVendor) {
      if (own.length < 2) continue;
      const perInvoice = new Map<number, typeof own>();
      for (const member of own) {
        const list = perInvoice.get(Number(member.invoice.id)) ?? [];
        list.push(member);
        perInvoice.set(Number(member.invoice.id), list);
      }
      for (const same of perInvoice.values()) {
        if (same.length > 1) {
          push("dup_in_invoice", `${key}:${same[0]!.invoice.id}`, { details: `العملية ${key} مكررة ${same.length} مرات في الفاتورة ${same[0]!.invoice.code ?? `#${same[0]!.invoice.id}`}`, line: same[0]!.line, occurrences: occurrences(same), vendor: same[0]!.invoice });
        }
      }
      // one representative per invoice for the cross-invoice checks
      const reps = [...perInvoice.values()].map((list) => list[0]!);
      if (reps.length < 2) continue;
      const byCycle = new Map<string, typeof reps>();
      for (const rep of reps) {
        const cycle = isoDay(rep.invoice.periodEnd) ?? "";
        const list = byCycle.get(cycle) ?? [];
        list.push(rep);
        byCycle.set(cycle, list);
      }
      for (const [cycle, sameCycle] of byCycle) {
        if (sameCycle.length > 1) {
          push("dup_same_cycle", `${key}:${vendorId}:${cycle}`, { details: `العملية ${key} على ${sameCycle.length} فواتير لنفس البائع في نفس التقفيلة`, line: sameCycle[0]!.line, occurrences: occurrences(sameCycle), vendor: sameCycle[0]!.invoice });
        }
      }
      if (byCycle.size > 1) {
        push("dup_cross_cycle", `${key}:${vendorId}`, { details: `العملية ${key} نزلت في ${byCycle.size} تقفيلات مختلفة لنفس البائع`, line: reps[0]!.line, occurrences: occurrences(reps), vendor: reps[0]!.invoice });
      }
    }
  }

  /* ---- per-line checks (5-7), counted-and-included lines of in-scope invoices ---- */
  for (const line of input.lines) {
    if (line.state !== LINE_STATE.INCLUDED) continue;
    const invoice = invoiceById.get(Number(line.invoiceId));
    if (!invoice || !input.scopeInvoiceIds.has(Number(invoice.id))) continue;
    const here = [occurrenceOf(line, invoice)];

    if (!operationKey(line)) {
      const noOrder = !String(line.orderNumber ?? "").trim();
      push("missing_operation", `${line.id}`, { details: noOrder ? "البند ملوش رقم عملية ولا رقم طلب" : "البند ملوش رقم عملية", line, occurrences: here, vendor: invoice });
    }

    const effective = effectiveLineCents(line);
    if (countsTowardCompanyDue(line) && effective.companyDue !== 0 && effective.vendorDue !== 0) {
      push("both_dues", `${line.id}`, {
        details: `البند عليه مستحق للشركة (${effective.companyDue / 100}) ومستحق للبائع (${effective.vendorDue / 100}) في نفس الوقت`,
        line, occurrences: here, vendor: invoice,
      });
    }

    const live = input.orders.get(Number(line.orderId));
    let reason: string | null = null;
    if (!live || live.deletedAt) reason = "الطلب اتحذف";
    else {
      const notBillable = notBillableReason(live);
      if (notBillable === "order_not_delivered") reason = "الطلب لم يعد مسلّمًا (اتلغى أو اتغيّرت حالته)";
      else if (notBillable === "shipment_not_delivered") reason = "حالة شحنة الطلب لم تعد «تم التسليم» (توصيل هوميكس) — الطلب لم يعد قابلاً للفوترة";
    }
    if (!reason && live && Boolean(line.isWarehouseDelivery) !== isLiveDeliveryWarehouse(live)) reason = "نوع التسليم اتغيّر (مخزن/بائع) بعد الفوترة";
    if (reason) push("order_changed", `${line.id}`, { details: reason, line, occurrences: here, vendor: invoice });
  }

  /* ---- drift (8) ---- */
  const linesByInvoice = new Map<number, IssueLine[]>();
  for (const line of input.lines) {
    const list = linesByInvoice.get(Number(line.invoiceId)) ?? [];
    list.push(line);
    linesByInvoice.set(Number(line.invoiceId), list);
  }
  for (const invoice of input.invoices) {
    if (!input.scopeInvoiceIds.has(Number(invoice.id))) continue;
    const adjustments = input.adjustments.filter((adjustment) => Number(adjustment.invoiceId) === Number(invoice.id));
    const recomputed = computeTotals((linesByInvoice.get(Number(invoice.id)) ?? []) as never, adjustments).netAmount;
    if (toCents(recomputed) !== toCents(invoice.netAmount)) {
      push("net_drift", `${invoice.id}`, {
        details: `الصافي المحفوظ ${Number(invoice.netAmount)} والمحسوب من البنود ${recomputed}`,
        line: null, occurrences: [occurrenceOf(null, invoice)], vendor: invoice,
      });
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
};

export const summarizeIssues = (issues: InvoiceIssue[]) => ({
  errors: issues.filter((issue) => issue.severity === "error").length,
  total: issues.length,
  warnings: issues.filter((issue) => issue.severity === "warning").length,
});

