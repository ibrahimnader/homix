import fs from "fs";
import moment from "moment-timezone";
import path from "path";

import { env } from "../../config/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors";
import type { OrderFinancialReportQuery, OrderFinancialReportResponse } from "../orders/order.types";
import {
  INVOICE_STATUS, INVOICE_STATUS_LABELS, LINE_ACTION_RULES, LINE_STATE, OVERDUE_DAYS, RECEIPT_FOLDER, VENDOR_VISIBLE_STATUSES,
  type InvoiceStatus, type LineAction,
} from "./invoice.constants";
import { isBillableOrderStatus } from "./invoice.eligibility";
import { canTransition, computeTotals, dueParty, daysCounter, effectiveLineCents, isOverdue, snapshotFromReportOrder } from "./invoice.logic";
import { fromCents, toCents } from "./invoice.money";
import type { InvoiceListFilters, InvoiceRepository, Tx } from "./invoice.repo";
import type { Actor, AdjustmentRow, InvoiceRow, LineRow, LineSnapshot } from "./invoice.types";

const CAIRO = "Africa/Cairo";

export type ReportProvider = (query: OrderFinancialReportQuery, vendorId?: number | null) => Promise<OrderFinancialReportResponse>;

/** Who is asking. `vendorId` is set (from the token) for vendor users and forces read scoping. */
export type Scope = { vendorId?: number | null };

type Deps = {
  getReport: ReportProvider;
  now?: () => Date;
  removeStoredFile?: (storedPath: string) => Promise<void>;
  repo: InvoiceRepository;
};

const num = (value: unknown): number => fromCents(toCents(value));
const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);
const cairoDay = (value: Date | string): string => moment.tz(value, CAIRO).format("YYYY-MM-DD");
const dayStart = (day: string): string => moment.tz(day, CAIRO).startOf("day").toISOString();
const dayEnd = (day: string): string => moment.tz(day, CAIRO).endOf("day").toISOString();

export const receiptMimeFor = (fileName: string): string => {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
};

export const resolveReceiptFile = (storedPath: string): string =>
  path.resolve(env.UPLOADS_DIR, RECEIPT_FOLDER, path.basename(storedPath));

const defaultRemoveStoredFile = async (storedPath: string): Promise<void> => {
  try {
    await fs.promises.unlink(resolveReceiptFile(storedPath));
  } catch {
    /* best effort: a missing file must not fail the request */
  }
};

export class InvoiceService {
  private readonly repo: InvoiceRepository;
  private readonly getReport: ReportProvider;
  private readonly now: () => Date;
  private readonly removeStoredFile: (storedPath: string) => Promise<void>;

  public constructor(deps: Deps) {
    this.repo = deps.repo;
    this.getReport = deps.getReport;
    this.now = deps.now ?? (() => new Date());
    this.removeStoredFile = deps.removeStoredFile ?? defaultRemoveStoredFile;
  }

  /* ---------- presentation ---------- */

  public toInvoiceDto(row: InvoiceRow) {
    const net = num(row.netAmount);
    const nowMs = this.now().getTime();
    const transferAmount = row.transferAmount === null || row.transferAmount === undefined ? null : num(row.transferAmount);
    return {
      adjustmentsTotal: num(row.adjustmentsTotal),
      amount: row.status === INVOICE_STATUS.TRANSFERRED && transferAmount !== null ? transferAmount : Math.abs(net),
      billingDay: row.billingDay,
      code: row.code,
      collectionTotal: num(row.collectionTotal),
      companyDueTotal: num(row.companyDueTotal),
      createdAt: iso(row.createdAt),
      daysCounter: daysCounter(row, nowMs),
      dueParty: dueParty(net),
      finesTotal: num(row.finesTotal),
      frozenAt: iso(row.frozenAt),
      hasReceipt: Boolean(row.receiptPath),
      id: Number(row.id),
      isOverdue: isOverdue(row, nowMs),
      netAmount: net,
      ordersCount: Number(row.ordersCount),
      overdueDays: OVERDUE_DAYS,
      periodEnd: iso(row.periodEnd),
      periodStart: iso(row.periodStart),
      receiptName: row.receiptName,
      receiptUploadedAt: iso(row.receiptUploadedAt),
      reviewedAt: iso(row.reviewedAt),
      status: row.status,
      statusLabel: INVOICE_STATUS_LABELS[row.status],
      transferAmount,
      transferredAt: iso(row.transferredAt),
      vendorDueTotal: num(row.vendorDueTotal),
      vendorId: row.vendorId,
      vendorName: row.vendorName ?? "",
      vendorShippingCost: num(row.vendorShippingCost),
      warehouseCost: num(row.warehouseCost),
    };
  }

  public toLineDto(line: LineRow) {
    const effective = effectiveLineCents(line);
    return {
      collectionTotal: num(line.collectionTotal),
      companyDue: fromCents(effective.companyDue),
      companyDueOverride: line.companyDueOverride === null ? null : num(line.companyDueOverride),
      fines: fromCents(effective.fines),
      finesOverride: line.finesOverride === null ? null : num(line.finesOverride),
      id: Number(line.id),
      isWarehouseDelivery: Boolean(line.isWarehouseDelivery),
      operationNumber: line.operationNumber,
      orderId: Number(line.orderId),
      orderNumber: line.orderNumber,
      originalCompanyDue: num(line.companyDue),
      originalFines: num(line.fines),
      originalVendorDue: num(line.vendorDue),
      overrideReason: line.overrideReason,
      paymentStatus: line.paymentStatus,
      paymentStatusLabel: line.paymentStatusLabel,
      productCode: line.productCode,
      state: line.state,
      stateChangedAt: iso(line.stateChangedAt),
      stateReason: line.stateReason,
      vendorDue: fromCents(effective.vendorDue),
      vendorDueOverride: line.vendorDueOverride === null ? null : num(line.vendorDueOverride),
      vendorShippingCost: num(line.vendorShippingCost),
      warehouseCost: num(line.warehouseCost),
    };
  }

  public toAdjustmentDto(row: AdjustmentRow) {
    return { amount: num(row.amount), createdAt: iso(row.createdAt), id: Number(row.id), kind: row.kind, label: row.label, removedAt: iso(row.removedAt) };
  }

  /* ---------- scoping ---------- */

  private assertReadable(invoice: InvoiceRow | null, scope: Scope): InvoiceRow {
    if (!invoice) throw new NotFoundError("الفاتورة غير موجودة");
    if (scope.vendorId && (Number(invoice.vendorId) !== Number(scope.vendorId) || !VENDOR_VISIBLE_STATUSES.includes(invoice.status))) {
      // 404, not 403: do not reveal that another vendor's invoice exists
      throw new NotFoundError("الفاتورة غير موجودة");
    }
    return invoice;
  }

  private async mustFind(id: number, transaction: Tx): Promise<InvoiceRow> {
    const invoice = await this.repo.findInvoice(id, transaction, true);
    if (!invoice) throw new NotFoundError("الفاتورة غير موجودة");
    return invoice;
  }

  private assertDraft(invoice: InvoiceRow): void {
    if (invoice.status !== INVOICE_STATUS.DRAFT) {
      throw new ConflictError("الفاتورة مقفلة — أرجعها إلى «معلّقة» أولاً لتعديلها");
    }
  }

  /* ---------- reads ---------- */

  public async list(query: {
    billingDay?: number; dueParty?: "vendor" | "homix"; invoiceFrom?: string; invoiceTo?: string; overdue?: boolean;
    page: number; receipt?: "uploaded" | "missing"; search?: string; size: number; statuses?: InvoiceStatus[];
    transferredFrom?: string; transferredTo?: string; vendorId?: number;
  }, scope: Scope) {
    let statuses = query.statuses;
    let vendorId = query.vendorId;
    if (scope.vendorId) {
      vendorId = Number(scope.vendorId);
      statuses = statuses?.length ? statuses.filter((status) => VENDOR_VISIBLE_STATUSES.includes(status)) : [...VENDOR_VISIBLE_STATUSES];
      if (statuses.length === 0) statuses = [...VENDOR_VISIBLE_STATUSES];
    }
    const filters: InvoiceListFilters = {
      billingDay: query.billingDay,
      dueParty: query.dueParty,
      invoiceFrom: query.invoiceFrom ? dayStart(query.invoiceFrom) : undefined,
      invoiceTo: query.invoiceTo ? dayEnd(query.invoiceTo) : undefined,
      overdueDays: OVERDUE_DAYS,
      overdueOnly: query.overdue,
      page: query.page,
      receipt: query.receipt,
      search: query.search,
      size: query.size,
      statuses,
      transferredFrom: query.transferredFrom ? dayStart(query.transferredFrom) : undefined,
      transferredTo: query.transferredTo ? dayEnd(query.transferredTo) : undefined,
      vendorId,
    };
    const [{ rows, total }, counts] = await Promise.all([
      this.repo.listInvoices(filters),
      this.repo.countByStatus(vendorId, scope.vendorId ? VENDOR_VISIBLE_STATUSES : undefined),
    ]);
    return { counts, items: rows.map((row) => this.toInvoiceDto(row)), page: query.page, size: query.size, total };
  }

  public async detail(id: number, scope: Scope) {
    const invoice = this.assertReadable(await this.repo.findInvoice(id), scope);
    const [lines, adjustments] = await Promise.all([this.repo.listLines(id), this.repo.listAdjustments(id)]);
    const isStaff = !scope.vendorId;
    return {
      adjustments: adjustments.filter((row) => isStaff || !row.removedAt).map((row) => this.toAdjustmentDto(row)),
      // Vendors only see counted lines; deferred/frozen/removed are internal handling.
      invoice: this.toInvoiceDto(invoice),
      lines: lines
        .filter((line) => isStaff || line.state === LINE_STATE.INCLUDED)
        .map((line) => {
          const dto = this.toLineDto(line);
          if (isStaff) return dto;
          // internal handling notes and pre-override amounts are not for vendors
          const { overrideReason, stateReason, originalCompanyDue, originalFines, originalVendorDue, ...visible } = dto;
          void [overrideReason, stateReason, originalCompanyDue, originalFines, originalVendorDue];
          return visible;
        }),
    };
  }

  public async invoicedLines(query: { page: number; q?: string; size: number; vendorId?: number }, scope: Scope) {
    const vendorId = scope.vendorId ? Number(scope.vendorId) : query.vendorId;
    const { rows, total } = await this.repo.listInvoicedLines({
      page: query.page, q: query.q, size: query.size, statuses: [...VENDOR_VISIBLE_STATUSES, ...(scope.vendorId ? [] : [INVOICE_STATUS.FROZEN])], vendorId,
    });
    return {
      items: rows.map((row) => ({
        ...this.toLineDto(row),
        hasReceipt: Boolean(row.receiptPath),
        invoiceCode: row.code,
        invoiceId: Number(row.invoiceId),
        invoiceStatus: row.invoiceStatus,
        invoiceStatusLabel: INVOICE_STATUS_LABELS[row.invoiceStatus],
        periodEnd: iso(row.periodEnd),
        transferredAt: iso(row.transferredAt),
        vendorId: row.vendorId,
        vendorName: row.vendorName,
      })),
      page: query.page, size: query.size, total,
    };
  }

  public async activity(query: { invoiceId?: number; page: number; size: number }) {
    return { ...(await this.repo.listEvents(query)), page: query.page, size: query.size };
  }

  public async reconciliationSummary(range: { from?: string; to?: string }) {
    const { count, totalCents } = await this.repo.transferredTotal({
      from: range.from ? dayStart(range.from) : undefined, to: range.to ? dayEnd(range.to) : undefined,
    });
    return { count, systemTotal: fromCents(totalCents) };
  }

  public async recordReconciliation(input: { bankTotal: number; from?: string; to?: string }, actor: Actor) {
    const summary = await this.reconciliationSummary(input);
    const difference = fromCents(toCents(input.bankTotal) - toCents(summary.systemTotal));
    await this.repo.transaction((transaction) => this.repo.insertEvent({
      action: "reconciliation.recorded",
      actorId: actor.id,
      detail: { bankTotal: input.bankTotal, count: summary.count, difference, from: input.from ?? null, systemTotal: summary.systemTotal, to: input.to ?? null },
    }, transaction));
    return { ...summary, bankTotal: num(input.bankTotal), difference };
  }

  /* ---------- generation / sync ---------- */

  private async lookupSnapshot(orderId: number, vendorId: number, transaction: Tx): Promise<LineSnapshot | null> {
    const order = await this.repo.findOrderForInvoicing(orderId, transaction);
    if (!order || !order.effectiveDeliveryDate || !isBillableOrderStatus(order.status)) return null;
    const day = cairoDay(order.effectiveDeliveryDate);
    const report = await this.getReport({ endDate: day, startDate: day, vendorId }, vendorId);
    const item = report.fullInvoice.items.find((row) => Number(row.vendorId) === vendorId);
    const reported = item?.orders.find((row) => Number(row.orderId) === orderId);
    return reported ? snapshotFromReportOrder(reported) : null;
  }

  /** Adds new report orders and pickable deferred orders to a draft. Never touches existing lines. */
  private async fillDraft(invoice: InvoiceRow, reportOrders: LineSnapshot[], actor: Actor, transaction: Tx) {
    const vendorId = Number(invoice.vendorId);
    const candidates = new Map<number, LineSnapshot>(reportOrders.map((snapshot) => [snapshot.orderId, snapshot]));
    const skippedDeferred: number[] = [];
    const deferredOrderIds = new Set<number>();
    for (const deferred of await this.repo.listPickableDeferred(vendorId, invoice.id, transaction)) {
      const orderId = Number(deferred.orderId);
      if (candidates.has(orderId) || deferredOrderIds.has(orderId)) continue;
      deferredOrderIds.add(orderId);
      const fresh = await this.lookupSnapshot(orderId, vendorId, transaction);
      if (fresh) candidates.set(orderId, fresh); else skippedDeferred.push(orderId);
    }
    const locked = await this.repo.findLockedOrderIds([...candidates.keys()], transaction);
    const fresh = [...candidates.values()].filter((snapshot) => !locked.has(snapshot.orderId));
    const added = await this.repo.insertLines(invoice.id, fresh, actor.id, transaction);
    await this.recomputeTotals(invoice.id, transaction);
    return { added, pickedDeferred: added.filter((orderId) => deferredOrderIds.has(orderId)), skippedDeferred };
  }

  private async recomputeTotals(invoiceId: number | string, transaction: Tx) {
    const [lines, adjustments] = await Promise.all([this.repo.listLines(invoiceId, transaction), this.repo.listAdjustments(invoiceId, transaction)]);
    const totals = computeTotals(lines, adjustments);
    await this.repo.updateTotals(invoiceId, totals, transaction);
    return totals;
  }

  public async generate(input: { billingDay: 13 | 28; referenceDate?: string; vendorId?: number }, actor: Actor) {
    const report = await this.getReport(
      { billingDay: input.billingDay, referenceDate: input.referenceDate, vendorId: input.vendorId },
      input.vendorId ?? null,
    );
    if (new Date(report.cycle.endDate).getTime() >= this.now().getTime()) {
      throw new ConflictError("دورة الفوترة لم تُغلق بعد — لا يمكن إصدار فواتيرها");
    }
    const byVendor = new Map<number, LineSnapshot[]>();
    for (const item of report.fullInvoice.items) {
      if (!item.vendorId) continue; // unknown vendor cannot own an invoice
      byVendor.set(Number(item.vendorId), item.orders.map((order) => snapshotFromReportOrder(order)));
    }
    if (input.vendorId && !byVendor.has(input.vendorId)) byVendor.set(input.vendorId, []);

    const results: Array<{ added: number; created: boolean; invoiceId: number; skippedDeferred: number[]; status: InvoiceStatus; vendorId: number }> = [];
    for (const [vendorId, snapshots] of byVendor) {
      results.push(await this.repo.transaction(async (transaction) => {
        const { created, invoice } = await this.repo.upsertDraft({
          billingDay: report.cycle.billingDay, createdBy: actor.id, periodEnd: report.cycle.endDate, periodStart: report.cycle.startDate, vendorId,
        }, transaction);
        let added: number[] = [];
        let skippedDeferred: number[] = [];
        if (invoice.status === INVOICE_STATUS.DRAFT) {
          ({ added, skippedDeferred } = await this.fillDraft(invoice, snapshots, actor, transaction));
        }
        if (created || added.length > 0) {
          await this.repo.insertEvent({
            action: created ? "invoice.generated" : "invoice.synced",
            actorId: actor.id,
            detail: { added, billingDay: report.cycle.billingDay, periodEnd: report.cycle.endDate, skippedDeferred },
            invoiceId: invoice.id,
            toStatus: invoice.status,
            vendorId,
          }, transaction);
        }
        return { added: added.length, created, invoiceId: Number(invoice.id), skippedDeferred, status: invoice.status, vendorId };
      }));
    }
    return { cycle: report.cycle, invoices: results };
  }

  public async sync(id: number, actor: Actor) {
    const probe = await this.repo.findInvoice(id);
    if (!probe) throw new NotFoundError("الفاتورة غير موجودة");
    // Report is computed outside the DB transaction (it is read-only and slow).
    const cycleDay = cairoDay(probe.periodEnd);
    const report = await this.getReport(
      { billingDay: probe.billingDay as 13 | 28, referenceDate: cycleDay, vendorId: Number(probe.vendorId) },
      Number(probe.vendorId),
    );
    const item = report.fullInvoice.items.find((row) => Number(row.vendorId) === Number(probe.vendorId));
    const snapshots = (item?.orders ?? []).map((order) => snapshotFromReportOrder(order));
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const result = await this.fillDraft(invoice, snapshots, actor, transaction);
      if (result.added.length > 0) {
        await this.repo.insertEvent({
          action: "invoice.synced", actorId: actor.id, detail: { added: result.added, pickedDeferred: result.pickedDeferred, skippedDeferred: result.skippedDeferred },
          invoiceId: invoice.id, toStatus: invoice.status, vendorId: invoice.vendorId,
        }, transaction);
      }
      return { added: result.added.length, skippedDeferred: result.skippedDeferred };
    });
  }

  /* ---------- status transitions ---------- */

  public async transition(id: number, to: InvoiceStatus, options: { transferAmount?: number }, actor: Actor) {
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      const from = invoice.status;
      if (!canTransition(from, to)) {
        throw new ConflictError(`لا يمكن الانتقال من «${INVOICE_STATUS_LABELS[from]}» إلى «${INVOICE_STATUS_LABELS[to]}»`);
      }
      const at = this.now();
      const fields: Record<string, unknown> = { status: to };
      const detail: Record<string, unknown> = {};

      if (from === "draft" && to === "reviewed") {
        const totals = await this.recomputeTotals(invoice.id, transaction);
        if (totals.ordersCount === 0 && totals.adjustmentsTotal === 0) {
          throw new ConflictError("لا يمكن مراجعة فاتورة فارغة (لا طلبات محسوبة ولا تعديلات)");
        }
        if (!invoice.code) {
          const sequence = await this.repo.nextInvoiceSequence(transaction);
          fields.code = `INV-${moment.tz(at, CAIRO).format("YYYY")}-${String(sequence).padStart(4, "0")}`;
        }
        Object.assign(fields, { frozenAt: null, frozenDurationMs: 0, reviewedAt: at, reviewedBy: actor.id });
        Object.assign(detail, { netAmount: totals.netAmount, ordersCount: totals.ordersCount });
      } else if (from === "reviewed" && to === "draft") {
        if (invoice.receiptPath || invoice.transferredAt) {
          throw new ConflictError("لا يمكن إرجاع فاتورة عليها إيصال أو بيانات تحويل إلى «معلّقة»");
        }
        Object.assign(fields, { frozenAt: null, frozenDurationMs: 0, reviewedAt: null, reviewedBy: null });
      } else if (from === "reviewed" && to === "frozen") {
        Object.assign(fields, { frozenAt: at, frozenBy: actor.id });
      } else if (from === "frozen" && to === "reviewed") {
        const frozenFor = invoice.frozenAt ? Math.max(0, at.getTime() - new Date(invoice.frozenAt).getTime()) : 0;
        Object.assign(fields, { frozenAt: null, frozenDurationMs: Number(invoice.frozenDurationMs) + frozenFor });
        detail.frozenForMs = frozenFor;
      } else if (from === "reviewed" && to === "transferred") {
        const computed = Math.abs(num(invoice.netAmount));
        const amount = options.transferAmount ?? computed;
        if (!Number.isFinite(amount) || amount < 0) throw new ValidationError("مبلغ التحويل غير صالح");
        Object.assign(fields, { transferAmount: num(amount), transferredAt: at, transferredBy: actor.id });
        Object.assign(detail, { computedAmount: computed, difference: fromCents(toCents(amount) - toCents(computed)), transferAmount: num(amount) });
      } else if (from === "transferred" && to === "reviewed") {
        Object.assign(fields, { transferAmount: null, transferredAt: null, transferredBy: null });
        Object.assign(detail, { previousTransferAmount: invoice.transferAmount === null ? null : num(invoice.transferAmount), previousTransferredAt: iso(invoice.transferredAt) });
      }

      await this.repo.updateInvoiceFields(invoice.id, fields, transaction);
      await this.repo.insertEvent({
        action: `invoice.${to === "draft" ? "reverted_to_draft" : to === "reviewed" ? (from === "draft" ? "reviewed" : from === "frozen" ? "unfrozen" : "transfer_reverted") : to}`,
        actorId: actor.id, detail, fromStatus: from, invoiceId: invoice.id, toStatus: to, vendorId: invoice.vendorId,
      }, transaction);
      return this.toInvoiceDto((await this.repo.findInvoice(invoice.id, transaction))!);
    });
  }

  public async bulkTransition(ids: number[], to: InvoiceStatus, actor: Actor) {
    const results: Array<{ error?: string; id: number; ok: boolean }> = [];
    for (const id of [...new Set(ids)]) {
      try {
        await this.transition(id, to, {}, actor);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ error: error instanceof Error ? error.message : "failed", id, ok: false });
      }
    }
    return { results, succeeded: results.filter((row) => row.ok).length };
  }

  /* ---------- adjustments ---------- */

  public async addAdjustment(id: number, input: { amount: number; kind: "addition" | "deduction"; label: string }, actor: Actor) {
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const adjustment = await this.repo.insertAdjustment(invoice.id, { ...input, amount: num(input.amount) }, actor.id, transaction);
      const totals = await this.recomputeTotals(invoice.id, transaction);
      await this.repo.insertEvent({
        action: "adjustment.added", actorId: actor.id, detail: { ...input, adjustmentId: Number(adjustment.id), netAmount: totals.netAmount },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return { adjustment: this.toAdjustmentDto(adjustment), netAmount: totals.netAmount };
    });
  }

  public async removeAdjustment(id: number, adjustmentId: number, actor: Actor) {
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const removed = await this.repo.removeAdjustment(invoice.id, adjustmentId, actor.id, transaction);
      if (!removed) throw new NotFoundError("التعديل غير موجود");
      const totals = await this.recomputeTotals(invoice.id, transaction);
      await this.repo.insertEvent({
        action: "adjustment.removed", actorId: actor.id, detail: { adjustmentId, amount: num(removed.amount), kind: removed.kind, label: removed.label, netAmount: totals.netAmount },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return { netAmount: totals.netAmount };
    });
  }

  /* ---------- lines ---------- */

  public async setOverrides(
    id: number,
    lineId: number,
    patch: { companyDueOverride?: number | null; finesOverride?: number | null; reason?: string; vendorDueOverride?: number | null },
    actor: Actor,
  ) {
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const line = await this.repo.findLine(invoice.id, lineId, transaction);
      if (!line) throw new NotFoundError("الطلب غير موجود في الفاتورة");
      if (line.state === LINE_STATE.REMOVED || line.state === LINE_STATE.DEFERRED) throw new ConflictError("لا يمكن تعديل طلب محذوف أو مؤجّل");
      const pick = (key: "companyDueOverride" | "finesOverride" | "vendorDueOverride") =>
        patch[key] === undefined ? (line[key] === null ? null : num(line[key])) : patch[key]!;
      const next = {
        companyDueOverride: pick("companyDueOverride"),
        finesOverride: pick("finesOverride"),
        overrideReason: patch.reason?.trim() || line.overrideReason,
        vendorDueOverride: pick("vendorDueOverride"),
      };
      await this.repo.setLineOverrides(line.id, next, transaction);
      const totals = await this.recomputeTotals(invoice.id, transaction);
      await this.repo.insertEvent({
        action: "line.overridden", actorId: actor.id,
        detail: {
          lineId, orderId: Number(line.orderId), reason: patch.reason ?? null,
          from: { companyDueOverride: line.companyDueOverride, finesOverride: line.finesOverride, vendorDueOverride: line.vendorDueOverride },
          to: next, netAmount: totals.netAmount,
        },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return { line: this.toLineDto((await this.repo.findLine(invoice.id, lineId, transaction))!), netAmount: totals.netAmount };
    });
  }

  public async lineAction(id: number, lineId: number, action: LineAction, reason: string | undefined, actor: Actor) {
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const line = await this.repo.findLine(invoice.id, lineId, transaction);
      if (!line) throw new NotFoundError("الطلب غير موجود في الفاتورة");
      const rule = LINE_ACTION_RULES[action];
      if (!rule.from.includes(line.state)) throw new ConflictError("هذا الإجراء غير متاح لحالة الطلب الحالية");
      if (rule.to === LINE_STATE.INCLUDED) {
        const locked = await this.repo.findLockedOrderIds([Number(line.orderId)], transaction);
        if (locked.has(Number(line.orderId)) && line.state !== LINE_STATE.FROZEN) {
          throw new ConflictError("هذا الطلب موجود بالفعل في فاتورة أخرى");
        }
      }
      await this.repo.setLineState(line.id, rule.to, reason?.trim() || null, actor.id, transaction);
      const totals = await this.recomputeTotals(invoice.id, transaction);
      await this.repo.insertEvent({
        action: `line.${action}`, actorId: actor.id,
        detail: { fromState: line.state, lineId, netAmount: totals.netAmount, orderId: Number(line.orderId), orderNumber: line.orderNumber, reason: reason ?? null, toState: rule.to },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return { netAmount: totals.netAmount, state: rule.to };
    });
  }

  public async orderCandidates(id: number, q: string) {
    const invoice = await this.repo.findInvoice(id);
    if (!invoice) throw new NotFoundError("الفاتورة غير موجودة");
    return this.repo.searchOrderCandidates(Number(invoice.vendorId), q);
  }

  public async addOrder(id: number, orderId: number, actor: Actor) {
    const probe = await this.repo.findInvoice(id);
    if (!probe) throw new NotFoundError("الفاتورة غير موجودة");
    // Pricing runs through the same report code as everything else (outside the invoice lock).
    const snapshot = await this.repo.transaction((transaction) => this.lookupSnapshot(orderId, Number(probe.vendorId), transaction));
    if (!snapshot) throw new ConflictError("الطلب غير مسلّم أو لا يخص هذا البائع");
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const added = await this.repo.insertLines(invoice.id, [snapshot], actor.id, transaction);
      if (added.length === 0) throw new ConflictError("هذا الطلب موجود بالفعل في فاتورة أخرى أو تم حذفه نهائيًا من الفواتير");
      const totals = await this.recomputeTotals(invoice.id, transaction);
      await this.repo.insertEvent({
        action: "line.added", actorId: actor.id, detail: { netAmount: totals.netAmount, orderId, orderNumber: snapshot.orderNumber },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return { netAmount: totals.netAmount };
    });
  }

  /* ---------- receipt ---------- */

  public async setReceipt(id: number, file: { name: string; path: string }, actor: Actor) {
    const previous = await this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      if (invoice.status !== INVOICE_STATUS.TRANSFERRED) throw new ConflictError("لا يمكن رفع إيصال إلا لفاتورة «تم التحويل»");
      await this.repo.updateInvoiceFields(invoice.id, {
        receiptMime: receiptMimeFor(file.name), receiptName: file.name, receiptPath: file.path,
        receiptUploadedAt: this.now(), receiptUploadedBy: actor.id,
      }, transaction);
      await this.repo.insertEvent({
        action: "receipt.uploaded", actorId: actor.id, detail: { fileName: file.name, replaced: Boolean(invoice.receiptPath) },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return invoice.receiptPath;
    });
    if (previous) await this.removeStoredFile(previous);
  }

  public async removeReceipt(id: number, actor: Actor) {
    const previous = await this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      if (!invoice.receiptPath) throw new NotFoundError("لا يوجد إيصال");
      if (invoice.status !== INVOICE_STATUS.TRANSFERRED) throw new ConflictError("لا يمكن حذف الإيصال إلا من فاتورة «تم التحويل»");
      await this.repo.updateInvoiceFields(invoice.id, {
        receiptMime: null, receiptName: null, receiptPath: null, receiptUploadedAt: null, receiptUploadedBy: null,
      }, transaction);
      await this.repo.insertEvent({
        action: "receipt.removed", actorId: actor.id, detail: { fileName: invoice.receiptName },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return invoice.receiptPath;
    });
    if (previous) await this.removeStoredFile(previous);
  }

  /** Authorises a receipt read (vendors: own transferred invoice only) and returns the file info. */
  public async receiptFor(id: number, scope: Scope): Promise<{ absolutePath: string; mime: string; name: string }> {
    const invoice = this.assertReadable(await this.repo.findInvoice(id), scope);
    if (!invoice.receiptPath) throw new NotFoundError("لا يوجد إيصال");
    if (scope.vendorId && invoice.status !== INVOICE_STATUS.TRANSFERRED) throw new ForbiddenError("Forbidden");
    return { absolutePath: resolveReceiptFile(invoice.receiptPath), mime: invoice.receiptMime ?? "application/octet-stream", name: invoice.receiptName ?? "receipt" };
  }
}
