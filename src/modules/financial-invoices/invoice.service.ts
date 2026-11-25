import fs from "fs";
import moment from "moment-timezone";
import path from "path";

import { env } from "../../config/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors";
import type { OrderFinancialReportQuery, OrderFinancialReportResponse } from "../orders/order.types";
import {
  ARCHIVE_STATUSES, CONSOLIDATED_CODE_SUFFIX, INVOICE_KIND, INVOICE_STATUS, INVOICE_STATUS_LABELS, invoiceStatusLabel, LINE_ACTION_RULES, LINE_STATE, MAX_RECEIPTS_PER_INVOICE,
  MAX_RECEIPTS_PER_UPLOAD, MERGEABLE_STATUSES, OVERDUE_DAYS, RECEIPT_FOLDER, VENDOR_VISIBLE_STATUSES,
  type InvoiceStatus, type LineAction,
} from "./invoice.constants";
import { isBillableOrderStatus } from "./invoice.eligibility";
import { canTransition, computeTotals, dueParty, daysCounter, effectiveLineCents, isOverdue, lineNetCents, snapshotFromReportOrder } from "./invoice.logic";
import { overlayReport, type ExportReport, type OverlayInvoice, type OverlayLine } from "./invoice.export-overlay";
import { fromCents, toCents } from "./invoice.money";
import type { InvoiceListFilters, InvoiceRepository, Tx, VendorBankRow } from "./invoice.repo";
import type { Actor, AdjustmentRow, InvoiceRow, LineRow, LineSnapshot, ReceiptRow } from "./invoice.types";

const CAIRO = "Africa/Cairo";

export type ReportProvider = (query: OrderFinancialReportQuery, vendorId?: number | null) => Promise<OrderFinancialReportResponse>;

/**
 * Who is asking. `vendorId` is set (from the token) for vendor users and forces read scoping.
 * `canSettle` = staff holding finance_settle: the only non-vendor scope that may read vendors' bank data.
 */
export type Scope = { canSettle?: boolean; vendorId?: number | null };

/** A vendor's payout details, exposed only to finance_settle staff and to the vendor himself (see `vendorBankFor`). */
export type VendorBank = { accountHolder: string | null; accountNumber: string | null; bankName: string | null; instaPayNumber: string | null; walletNumber: string | null };

const clean = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
};
const toVendorBank = (row: VendorBankRow | undefined): VendorBank | null => {
  if (!row) return null;
  const bank: VendorBank = {
    accountHolder: clean(row.bankAccountHolderName), accountNumber: clean(row.bankAccountNumber), bankName: clean(row.bankName),
    instaPayNumber: clean(row.instaPayNumber), walletNumber: clean(row.walletNumber),
  };
  return Object.values(bank).some((value) => value !== null) ? bank : null;
};

/** Which (vendor, cycle) draft a live-row action targets. `referenceDate` = a Cairo day inside the cycle (the cycle end day). */
export type LiveDraftInput = { billingDay: 13 | 28; referenceDate?: string; vendorId: number };

type Deps = {
  getReport: ReportProvider;
  now?: () => Date;
  removeStoredFile?: (storedPath: string) => Promise<void>;
  repo: InvoiceRepository;
  /** size in bytes of a stored receipt file (null when unknown); injectable for tests */
  statStoredFile?: (storedPath: string) => Promise<number | null>;
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

const defaultStatStoredFile = async (storedPath: string): Promise<number | null> => {
  try {
    return (await fs.promises.stat(resolveReceiptFile(storedPath))).size;
  } catch {
    return null;
  }
};

export type ReceiptFile = { name: string; path: string };

export class InvoiceService {
  private readonly statStoredFile: (storedPath: string) => Promise<number | null>;
  private readonly repo: InvoiceRepository;
  private readonly getReport: ReportProvider;
  private readonly now: () => Date;
  private readonly removeStoredFile: (storedPath: string) => Promise<void>;

  public constructor(deps: Deps) {
    this.repo = deps.repo;
    this.getReport = deps.getReport;
    this.now = deps.now ?? (() => new Date());
    this.removeStoredFile = deps.removeStoredFile ?? defaultRemoveStoredFile;
    this.statStoredFile = deps.statStoredFile ?? defaultStatStoredFile;
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
      hasReceipt: this.receiptsCountOf(row) > 0,
      id: Number(row.id),
      isOverdue: isOverdue(row, nowMs),
      kind: row.kind ?? INVOICE_KIND.STANDARD,
      /** can be merged into a consolidated invoice right now (the server re-checks under a row lock) */
      mergeable: this.mergeBlockReason(row) === null,
      mergedCode: row.mergedCode ?? null,
      mergedIntoId: row.mergedIntoId === null || row.mergedIntoId === undefined ? null : Number(row.mergedIntoId),
      netAmount: net,
      ordersCount: Number(row.ordersCount),
      overdueDays: OVERDUE_DAYS,
      periodEnd: iso(row.periodEnd),
      periodStart: iso(row.periodStart),
      receiptName: row.receiptName,
      receiptUploadedAt: iso(row.receiptUploadedAt),
      receiptsCount: this.receiptsCountOf(row),
      reviewedAt: iso(row.reviewedAt),
      status: row.status,
      statusLabel: invoiceStatusLabel(row.status, net),
      transferAmount,
      transferredAt: iso(row.transferredAt),
      vendorDueTotal: num(row.vendorDueTotal),
      vendorId: row.vendorId,
      vendorName: row.vendorName ?? "",
      vendorShippingCost: num(row.vendorShippingCost),
      warehouseCost: num(row.warehouseCost),
    };
  }

  /** Live receipts; rows built without the SQL count (tests, legacy callers) fall back to the single legacy receipt column. */
  private receiptsCountOf(row: InvoiceRow): number {
    if (row.receiptsCount !== undefined && row.receiptsCount !== null) return Number(row.receiptsCount);
    return row.receiptPath ? 1 : 0;
  }

  public toLineDto(line: LineRow) {
    const effective = effectiveLineCents(line);
    return {
      collectionOverride: line.collectionOverride === null || line.collectionOverride === undefined ? null : num(line.collectionOverride),
      collectionTotal: fromCents(effective.collection),
      companyDue: fromCents(effective.companyDue),
      companyDueKind: line.companyDueKind ?? (line.isWarehouseDelivery ? "margin" : "vendorOwes"),
      companyDueOverride: line.companyDueOverride === null ? null : num(line.companyDueOverride),
      fines: fromCents(effective.fines),
      finesOverride: line.finesOverride === null ? null : num(line.finesOverride),
      id: Number(line.id),
      isWarehouseDelivery: Boolean(line.isWarehouseDelivery),
      /** signed line net = vendorDue − companyDue (vendor deliveries only) − fines */
      netAmount: fromCents(lineNetCents(line)),
      operationNumber: line.operationNumber,
      orderId: Number(line.orderId),
      orderNumber: line.orderNumber,
      originalCollection: num(line.collectionTotal),
      originalCompanyDue: num(line.companyDue),
      originalFines: num(line.fines),
      originalVendorShippingCost: num(line.vendorShippingCost),
      originalVendorDue: num(line.vendorDue),
      originalWarehouseCost: num(line.warehouseCost),
      overrideReason: line.overrideReason,
      paymentStatus: line.paymentStatus,
      paymentStatusLabel: line.paymentStatusLabel,
      productCode: line.productCode,
      sourceInvoiceId: line.sourceInvoiceId === null || line.sourceInvoiceId === undefined ? null : Number(line.sourceInvoiceId),
      state: line.state,
      stateChangedAt: iso(line.stateChangedAt),
      stateReason: line.stateReason,
      vendorDue: fromCents(effective.vendorDue),
      vendorDueOverride: line.vendorDueOverride === null ? null : num(line.vendorDueOverride),
      vendorShippingCost: fromCents(effective.shipping),
      vendorShippingCostOverride: line.vendorShippingCostOverride === null || line.vendorShippingCostOverride === undefined ? null : num(line.vendorShippingCostOverride),
      warehouseCost: fromCents(effective.cost),
      warehouseCostOverride: line.warehouseCostOverride === null || line.warehouseCostOverride === undefined ? null : num(line.warehouseCostOverride),
    };
  }

  public toAdjustmentDto(row: AdjustmentRow) {
    return {
      amount: num(row.amount), createdAt: iso(row.createdAt), id: Number(row.id), kind: row.kind, label: row.label, removedAt: iso(row.removedAt),
      sourceInvoiceId: row.sourceInvoiceId === null || row.sourceInvoiceId === undefined ? null : Number(row.sourceInvoiceId),
    };
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
    if (invoice.status === INVOICE_STATUS.CONSOLIDATED) {
      throw new ConflictError(`الفاتورة مدمجة في الفاتورة الشاملة ${invoice.mergedCode ?? ""} — فُك الدمج أولاً لتعديلها`.replace("  ", " "));
    }
    if (invoice.status !== INVOICE_STATUS.DRAFT) {
      throw new ConflictError("الفاتورة مقفلة — أرجعها إلى «معلّقة» أولاً لتعديلها");
    }
  }

  /* ---------- reads ---------- */

  public async list(query: {
    billingDay?: number; dueParty?: "vendor" | "homix"; invoiceCode?: string; invoiceFrom?: string; invoiceTo?: string; kind?: "standard" | "consolidated"; month?: string; overdue?: boolean;
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
      invoiceCode: query.invoiceCode,
      invoiceFrom: query.invoiceFrom ? dayStart(query.invoiceFrom) : undefined,
      invoiceTo: query.invoiceTo ? dayEnd(query.invoiceTo) : undefined,
      kind: query.kind,
      monthFrom: query.month ? moment.tz(`${query.month}-01`, CAIRO).startOf("month").toISOString() : undefined,
      monthTo: query.month ? moment.tz(`${query.month}-01`, CAIRO).endOf("month").toISOString() : undefined,
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
    // chip counts follow every filter except the status/kind selection; a vendor's scope is enforced here too
    const countFilters: InvoiceListFilters = { ...filters, statuses: scope.vendorId ? [...VENDOR_VISIBLE_STATUSES] : ARCHIVE_STATUSES };
    const [{ rows, total }, counts, filteredCounts] = await Promise.all([
      this.repo.listInvoices(filters),
      this.repo.countByStatus(vendorId, scope.vendorId ? VENDOR_VISIBLE_STATUSES : undefined),
      this.repo.countFilteredByStatus(countFilters),
    ]);
    return { counts, filteredCounts, items: rows.map((row) => this.toInvoiceDto(row)), page: query.page, size: query.size, total };
  }

  /** Months (Cairo) that have archive invoices, for the month filter; vendors only see their own reviewed/transferred ones. */
  public async months(scope: Scope): Promise<Array<{ count: number; month: string }>> {
    const statuses: InvoiceStatus[] = scope.vendorId ? [...VENDOR_VISIBLE_STATUSES] : ARCHIVE_STATUSES;
    return this.repo.listInvoiceMonths(scope.vendorId ? Number(scope.vendorId) : undefined, statuses);
  }

  private canReadVendorBank(scope: Scope): boolean {
    return Boolean(scope.vendorId) || Boolean(scope.canSettle);
  }

  /** `undefined` = not allowed to see bank data (key omitted); `null` = allowed, none registered. */
  private async vendorBankFor(vendorId: number, scope: Scope): Promise<VendorBank | null | undefined> {
    if (!this.canReadVendorBank(scope)) return undefined;
    // a vendor only ever gets his own record, whatever vendorId the caller passed
    const id = scope.vendorId ? Number(scope.vendorId) : vendorId;
    return toVendorBank((await this.repo.listVendorBanks([id])).get(id));
  }

  /**
   * Adds `vendorBank` to the seller rows of the live report: to finance_settle staff for every vendor, to a vendor user for his own
   * row only (a vendor-scoped report only contains his own rows anyway; the id check is defence in depth). Other callers get the report unchanged.
   */
  public async withVendorBanks<T extends { fullInvoice: { items: Array<{ vendorId: number | null }> }; vendorDeliveries: { items: Array<{ vendorId: number | null }> }; warehouseDeliveries: { items: Array<{ vendorId: number | null }> } }>(
    report: T, scope: Scope,
  ): Promise<T> {
    if (!this.canReadVendorBank(scope)) return report;
    const sections = [report.fullInvoice, report.vendorDeliveries, report.warehouseDeliveries];
    const ids = sections.flatMap((section) => section.items.map((item) => item.vendorId)).filter((id): id is number => id !== null)
      .filter((id) => !scope.vendorId || Number(id) === Number(scope.vendorId));
    const banks = await this.repo.listVendorBanks(ids);
    for (const section of sections) {
      for (const item of section.items as Array<{ vendorId: number | null; vendorBank?: VendorBank | null }>) {
        if (item.vendorId === null || (scope.vendorId && Number(item.vendorId) !== Number(scope.vendorId))) continue;
        item.vendorBank = toVendorBank(banks.get(Number(item.vendorId)));
      }
    }
    return report;
  }

  /** Vendor view of a line: internal handling notes and pre-override amounts are not for vendors. */
  private toVendorLineDto<T extends ReturnType<InvoiceService["toLineDto"]>>(dto: T) {
    const {
      overrideReason, stateReason, originalCollection, originalCompanyDue, originalFines, originalVendorDue, originalWarehouseCost, originalVendorShippingCost,
      collectionOverride, companyDueOverride, finesOverride, vendorDueOverride, vendorShippingCostOverride, warehouseCostOverride, ...visible
    } = dto;
    void [overrideReason, stateReason, originalCollection, originalCompanyDue, originalFines, originalVendorDue, originalWarehouseCost, originalVendorShippingCost,
      collectionOverride, companyDueOverride, finesOverride, vendorDueOverride, vendorShippingCostOverride, warehouseCostOverride];
    return visible;
  }

  public async detail(id: number, scope: Scope) {
    const invoice = this.assertReadable(await this.repo.findInvoice(id), scope);
    const [lines, adjustments] = await Promise.all([this.repo.listLines(id), this.repo.listAdjustments(id)]);
    const isStaff = !scope.vendorId;
    const vendorBank = await this.vendorBankFor(Number(invoice.vendorId), scope);
    const sources = invoice.kind === INVOICE_KIND.CONSOLIDATED ? await this.repo.listMergedSources(id) : [];
    return {
      adjustments: adjustments.filter((row) => isStaff || !row.removedAt).map((row) => this.toAdjustmentDto(row)),
      // Vendors only see counted lines; deferred/frozen/removed are internal handling.
      invoice: this.toInvoiceDto(invoice),
      // «الفواتير المجمّعة (n)»: the invoices merged into a consolidated invoice, with cycle / month / net of each
      ...(invoice.kind === INVOICE_KIND.CONSOLIDATED ? { sources: sources.map((row) => this.toSourceDto(row)) } : {}),
      // payout details: finance_settle staff, or the vendor himself on his own invoice (assertReadable above); omitted otherwise
      ...(vendorBank === undefined ? {} : { vendorBank }),
      lines: lines
        .filter((line) => isStaff || line.state === LINE_STATE.INCLUDED)
        .map((line) => {
          const dto = this.toLineDto(line);
          return isStaff ? dto : this.toVendorLineDto(dto);
        }),
    };
  }

  /**
   * One request per billing cycle for the live report: which vendors already have an invoice (and its status),
   * plus only the lines the report cannot reproduce itself (see repo.listCycleOverlayLines) and the counted order ids.
   * Vendors only ever receive their own reviewed/transferred invoices and counted lines (never drafts/frozen).
   */
  public async cycleOverview(query: { periodEnd: string; vendorId?: number }, scope: Scope) {
    const vendorId = scope.vendorId ? Number(scope.vendorId) : query.vendorId;
    const invoices = await this.repo.listCycleInvoices({
      periodEndFrom: dayStart(query.periodEnd),
      periodEndTo: dayEnd(query.periodEnd),
      statuses: scope.vendorId ? [...VENDOR_VISIBLE_STATUSES] : undefined,
      vendorId,
    });
    const ids = invoices.map((row) => Number(row.id));
    const [overlayRows, included] = await Promise.all([this.repo.listCycleOverlayLines(ids), this.repo.listIncludedOrderIds(ids)]);
    const isStaff = !scope.vendorId;
    const includedOrderIds: Record<string, number[]> = {};
    for (const row of included) (includedOrderIds[String(row.invoiceId)] ??= []).push(Number(row.orderId));
    return {
      includedOrderIds,
      invoices: invoices.map((row) => ({
        adjustmentsTotal: num(row.adjustmentsTotal),
        code: row.code,
        id: Number(row.id),
        mergedCode: row.mergedCode ?? null,
        mergedIntoId: row.mergedIntoId === null || row.mergedIntoId === undefined ? null : Number(row.mergedIntoId),
        netAmount: num(row.netAmount),
        status: row.status,
        statusLabel: invoiceStatusLabel(row.status, num(row.netAmount)),
        vendorId: Number(row.vendorId),
      })),
      lines: overlayRows
        .filter((row) => isStaff || row.state === LINE_STATE.INCLUDED)
        .map((row) => {
          const dto = this.toLineDto(row);
          return { ...(isStaff ? dto : this.toVendorLineDto(dto)), invoiceId: Number(row.effectiveInvoiceId ?? row.invoiceId), outsideCycle: Boolean(row.outsideCycle), vendorId: Number(row.vendorId) };
        }),
    };
  }

  /**
   * The live report with the cycle's invoices laid over it, for the Excel export (same overlay as the screen / PDF).
   * Custom ranges have no invoices and stay live. Vendors only get their own reviewed/transferred invoices, counted lines
   * and effective amounts: override flags, reasons and uncounted lines never leave this method for a vendor scope.
   */
  public async effectiveReport(report: OrderFinancialReportResponse, scope: Scope, vendorId?: number): Promise<ExportReport> {
    const isVendor = Boolean(scope.vendorId);
    if (report.cycle.mode === "customRange") return overlayReport(report, [], isVendor);
    const periodEnd = cairoDay(report.cycle.endDate);
    const invoices = await this.repo.listCycleInvoices({
      periodEndFrom: dayStart(periodEnd),
      periodEndTo: dayEnd(periodEnd),
      statuses: isVendor ? [...VENDOR_VISIBLE_STATUSES] : undefined,
      vendorId: scope.vendorId ? Number(scope.vendorId) : vendorId,
    });
    const ids = invoices.map((row) => Number(row.id));
    const [overlayRows, included, adjustments] = await Promise.all([
      this.repo.listCycleOverlayLines(ids),
      this.repo.listIncludedOrderIds(ids),
      Promise.all(ids.map((id) => this.repo.listAdjustments(id))),
    ]);
    const overlayInvoices: OverlayInvoice[] = invoices.map((row, index) => ({
      adjustments: (adjustments[index] ?? []).filter((item) => !item.removedAt).map((item) => ({ amount: num(item.amount), kind: item.kind, label: item.label })),
      adjustmentsTotal: num(row.adjustmentsTotal),
      code: row.code,
      id: Number(row.id),
      includedOrderIds: included.filter((item) => Number(item.invoiceId) === Number(row.id)).map((item) => Number(item.orderId)),
      lines: overlayRows
        .filter((line) => Number(line.effectiveInvoiceId ?? line.invoiceId) === Number(row.id) && (!isVendor || line.state === LINE_STATE.INCLUDED))
        .map((line): OverlayLine => {
          const dto = this.toLineDto(line);
          // real flags drive which value is used (same for staff and vendor); the export hides them from vendors (overrideInfo)
          const flag = (value: unknown) => value !== null && value !== undefined;
          return {
            collectionOverridden: flag(line.collectionOverride), collectionTotal: dto.collectionTotal,
            companyDue: dto.companyDue, companyDueKind: dto.companyDueKind, companyDueOverridden: flag(line.companyDueOverride),
            fines: dto.fines, finesOverridden: flag(line.finesOverride), isWarehouseDelivery: dto.isWarehouseDelivery,
            operationNumber: dto.operationNumber, orderId: dto.orderId, orderNumber: dto.orderNumber, outsideCycle: Boolean(line.outsideCycle),
            paymentStatus: dto.paymentStatus, paymentStatusLabel: dto.paymentStatusLabel, productCode: dto.productCode,
            reason: isVendor ? null : (line.overrideReason ?? line.stateReason ?? null),
            state: line.state, vendorDue: dto.vendorDue, vendorDueOverridden: flag(line.vendorDueOverride),
            vendorShippingCost: dto.vendorShippingCost, vendorShippingOverridden: flag(line.vendorShippingCostOverride),
            warehouseCost: dto.warehouseCost, warehouseCostOverridden: flag(line.warehouseCostOverride),
          };
        }),
      netAmount: num(row.netAmount),
      status: row.status,
      vendorId: Number(row.vendorId),
    }));
    return overlayReport(report, overlayInvoices, isVendor);
  }

  /** Staff-only list for the vendor filter (finance_view is enough; vendors never reach it). */
  public vendorOptions() {
    return this.repo.listVendorOptions();
  }

  public async invoicedLines(query: {
    invoiceCode?: string; operationNumber?: string; orderNumber?: string; page: number; productCode?: string; q?: string; size: number; vendorId?: number[];
  }, scope: Scope) {
    // vendor users are always pinned to their own id, whatever list they send
    const vendorIds = scope.vendorId ? [Number(scope.vendorId)] : query.vendorId;
    const { rows, total } = await this.repo.listInvoicedLines({
      invoiceCode: query.invoiceCode, operationNumber: query.operationNumber, orderNumber: query.orderNumber, page: query.page,
      productCode: query.productCode, q: query.q, size: query.size,
      statuses: [...VENDOR_VISIBLE_STATUSES, ...(scope.vendorId ? [] : [INVOICE_STATUS.FROZEN])], vendorIds,
    });
    return {
      items: rows.map((row) => ({
        ...(scope.vendorId ? this.toVendorLineDto(this.toLineDto(row)) : this.toLineDto(row)),
        hasReceipt: Boolean(row.hasReceipt),
        invoiceCode: row.code,
        invoiceId: Number(row.invoiceId),
        invoiceStatus: row.invoiceStatus,
        invoiceStatusLabel: invoiceStatusLabel(row.invoiceStatus, num(row.invoiceNetAmount ?? 0)),
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
    // the open (current) cycle is allowed: it holds DRAFTS that sync keeps topping up; review is blocked until the cycle ends
    const byVendor = new Map<number, LineSnapshot[]>();
    for (const item of report.fullInvoice.items) {
      if (!item.vendorId) continue; // unknown vendor cannot own an invoice
      byVendor.set(Number(item.vendorId), item.orders.map((order) => snapshotFromReportOrder(order)));
    }
    if (input.vendorId && !byVendor.has(input.vendorId)) byVendor.set(input.vendorId, []);

    const results: Array<{ added: number; created: boolean; invoiceId: number; skippedDeferred: number[]; status: InvoiceStatus; vendorId: number }> = [];
    for (const [vendorId, snapshots] of byVendor) {
      results.push(await this.repo.transaction((transaction) => this.ensureDraft(report.cycle, vendorId, snapshots, actor, transaction)));
    }
    return { cycle: report.cycle, invoices: results };
  }

  /** Create-or-reuse the (vendor, cycle) invoice and top up a draft. Shared by generate and review-live. */
  private async ensureDraft(
    cycle: { billingDay: 13 | 28; endDate: string; startDate: string },
    vendorId: number,
    snapshots: LineSnapshot[],
    actor: Actor,
    transaction: Tx,
  ) {
    const { created, invoice } = await this.repo.upsertDraft({
      billingDay: cycle.billingDay, createdBy: actor.id, periodEnd: cycle.endDate, periodStart: cycle.startDate, vendorId,
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
        detail: { added, billingDay: cycle.billingDay, periodEnd: cycle.endDate, skippedDeferred },
        invoiceId: invoice.id,
        toStatus: invoice.status,
        vendorId,
      }, transaction);
    }
    return { added: added.length, created, invoiceId: Number(invoice.id), skippedDeferred, status: invoice.status, vendorId };
  }

  private snapshotsByVendor(report: OrderFinancialReportResponse): Map<number, LineSnapshot[]> {
    const byVendor = new Map<number, LineSnapshot[]>();
    for (const item of report.fullInvoice.items) {
      if (!item.vendorId) continue;
      byVendor.set(Number(item.vendorId), item.orders.map((order) => snapshotFromReportOrder(order)));
    }
    return byVendor;
  }

  private async reviewVendor(
    cycle: { billingDay: 13 | 28; endDate: string; startDate: string },
    vendorId: number,
    snapshots: LineSnapshot[],
    actor: Actor,
  ) {
    return this.repo.transaction(async (transaction) => {
      const { invoiceId } = await this.ensureDraft(cycle, vendorId, snapshots, actor, transaction);
      const invoice = (await this.repo.findInvoice(invoiceId, transaction, true))!;
      if (invoice.status !== INVOICE_STATUS.DRAFT) return { alreadyReviewed: true, invoice: this.toInvoiceDto(invoice) };
      return { alreadyReviewed: false, invoice: await this.transitionInTx(invoice.id, "reviewed", {}, actor, transaction) };
    });
  }

  /** One vendor: draft (create or reuse, manual overrides untouched) -> reviewed in one transaction. Idempotent. */
  public async reviewLive(input: { billingDay: 13 | 28; referenceDate?: string; vendorId: number }, actor: Actor) {
    const report = await this.getReport({ billingDay: input.billingDay, referenceDate: input.referenceDate, vendorId: input.vendorId }, input.vendorId);
    const snapshots = this.snapshotsByVendor(report).get(input.vendorId) ?? [];
    return { cycle: report.cycle, vendorId: input.vendorId, ...(await this.reviewVendor(report.cycle, input.vendorId, snapshots, actor)) };
  }

  /** Every vendor of the cycle that has counted orders; each in its own transaction, failures reported per vendor. */
  public async reviewLiveAll(input: { billingDay: 13 | 28; referenceDate?: string }, actor: Actor) {
    const report = await this.getReport({ billingDay: input.billingDay, referenceDate: input.referenceDate }, null);
    if (new Date(report.cycle.endDate).getTime() >= this.now().getTime()) {
      throw new ConflictError("الدورة لم تنتهِ بعد — لا يمكن مراجعة الفواتير");
    }
    const results: Array<{ alreadyReviewed?: boolean; error?: string; invoiceId?: number; ok: boolean; vendorId: number }> = [];
    for (const [vendorId, snapshots] of this.snapshotsByVendor(report)) {
      if (snapshots.length === 0) continue;
      try {
        const done = await this.reviewVendor(report.cycle, vendorId, snapshots, actor);
        results.push({ alreadyReviewed: done.alreadyReviewed, invoiceId: done.invoice.id, ok: true, vendorId });
      } catch (error) {
        results.push({ error: error instanceof Error ? error.message : "failed", ok: false, vendorId });
      }
    }
    return { cycle: report.cycle, failed: results.filter((row) => !row.ok).length, results, succeeded: results.filter((row) => row.ok).length };
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

  /**
   * Draft only: re-runs the live report for the invoice's vendor/cycle and refreshes the system-computed numbers
   * (cost, collection, fines, vendor/company due, vendor shipping) of the EXISTING lines. Manual overrides, their reasons,
   * line states (frozen/deferred/removed) and adjustments are preserved. Never run automatically.
   */
  public async refreshDraft(id: number, actor: Actor) {
    const probe = await this.repo.findInvoice(id);
    if (!probe) throw new NotFoundError("الفاتورة غير موجودة");
    this.assertDraft(probe);
    const report = await this.getReport(
      { billingDay: probe.billingDay as 13 | 28, referenceDate: cairoDay(probe.periodEnd), vendorId: Number(probe.vendorId) },
      Number(probe.vendorId),
    );
    const item = report.fullInvoice.items.find((row) => Number(row.vendorId) === Number(probe.vendorId));
    const fresh = new Map<number, LineSnapshot>((item?.orders ?? []).map((order) => [Number(order.orderId ?? order.id), snapshotFromReportOrder(order)]));
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const lines = await this.repo.listLines(id, transaction);
      const changes: Array<{ companyDue: [number, number]; orderId: number; vendorDue: [number, number] }> = [];
      for (const line of lines) {
        const orderId = Number(line.orderId);
        let snapshot = fresh.get(orderId) ?? null;
        // counted lines whose order is outside the cycle window (picked-up deferred / manually added) are looked up on their own
        if (!snapshot && (line.state === LINE_STATE.INCLUDED || line.state === LINE_STATE.FROZEN)) {
          snapshot = await this.lookupSnapshot(orderId, Number(invoice.vendorId), transaction);
        }
        if (!snapshot) continue;
        const same = toCents(line.collectionTotal) === toCents(snapshot.collectionTotal)
          && toCents(line.warehouseCost) === toCents(snapshot.warehouseCost)
          && toCents(line.fines) === toCents(snapshot.fines)
          && toCents(line.vendorShippingCost) === toCents(snapshot.vendorShippingCost)
          && toCents(line.vendorDue) === toCents(snapshot.vendorDue)
          && toCents(line.companyDue) === toCents(snapshot.companyDue)
          && (snapshot.companyDueKind === null || (line.companyDueKind ?? null) === snapshot.companyDueKind);
        if (same) continue;
        await this.repo.refreshLineSnapshot(line.id, snapshot, transaction);
        changes.push({ companyDue: [num(line.companyDue), snapshot.companyDue], orderId, vendorDue: [num(line.vendorDue), snapshot.vendorDue] });
      }
      const totals = await this.recomputeTotals(invoice.id, transaction);
      if (changes.length > 0) {
        await this.repo.insertEvent({
          action: "invoice.refreshed", actorId: actor.id, detail: { changes: changes.slice(0, 100), refreshed: changes.length, netAmount: totals.netAmount },
          invoiceId: invoice.id, toStatus: invoice.status, vendorId: invoice.vendorId,
        }, transaction);
      }
      return { refreshed: changes.length, totals };
    });
  }

  /* ---------- status transitions ---------- */

  public async transition(id: number, to: InvoiceStatus, options: { transferAmount?: number }, actor: Actor) {
    return this.repo.transaction((transaction) => this.transitionInTx(id, to, options, actor, transaction));
  }

  private async transitionInTx(id: number | string, to: InvoiceStatus, options: { transferAmount?: number }, actor: Actor, transaction: Tx) {
    {
      const invoice = await this.mustFind(Number(id), transaction);
      const from = invoice.status;
      if (!canTransition(from, to)) {
        throw new ConflictError(`لا يمكن الانتقال من «${INVOICE_STATUS_LABELS[from]}» إلى «${INVOICE_STATUS_LABELS[to]}»`);
      }
      const at = this.now();
      const fields: Record<string, unknown> = { status: to };
      const detail: Record<string, unknown> = {};

      if (from === "draft" && to === "reviewed") {
        if (new Date(invoice.periodEnd).getTime() >= this.now().getTime()) {
          throw new ConflictError("الدورة لم تنتهِ بعد — لا يمكن مراجعة الفاتورة");
        }
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
        if (this.receiptsCountOf(invoice) > 0 || invoice.transferredAt) {
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
    }
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
    patch: {
      collectionOverride?: number | null; companyDueOverride?: number | null; finesOverride?: number | null; reason?: string;
      vendorDueOverride?: number | null; vendorShippingCostOverride?: number | null; warehouseCostOverride?: number | null;
    },
    actor: Actor,
  ) {
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const line = await this.repo.findLine(invoice.id, lineId, transaction);
      if (!line) throw new NotFoundError("الطلب غير موجود في الفاتورة");
      if (line.state === LINE_STATE.REMOVED || line.state === LINE_STATE.DEFERRED) throw new ConflictError("لا يمكن تعديل طلب محذوف أو مؤجّل");
      if (typeof patch.vendorShippingCostOverride === "number" && (line.isWarehouseDelivery || line.companyDueKind === "margin")) {
        throw new ConflictError("شحن البائع ينطبق على تسليمات البائع فقط");
      }
      type Key = "collectionOverride" | "companyDueOverride" | "finesOverride" | "vendorDueOverride" | "vendorShippingCostOverride" | "warehouseCostOverride";
      const current = (key: Key): number | null => (line[key] === null || line[key] === undefined ? null : num(line[key]));
      const pick = (key: Key): number | null => (patch[key] === undefined ? current(key) : patch[key]!);
      const next = {
        collectionOverride: pick("collectionOverride"),
        companyDueOverride: pick("companyDueOverride"),
        finesOverride: pick("finesOverride"),
        overrideReason: patch.reason?.trim() || line.overrideReason,
        vendorDueOverride: pick("vendorDueOverride"),
        vendorShippingCostOverride: pick("vendorShippingCostOverride"),
        warehouseCostOverride: pick("warehouseCostOverride"),
      };
      const before = {
        collectionOverride: current("collectionOverride"), companyDueOverride: current("companyDueOverride"), finesOverride: current("finesOverride"),
        vendorDueOverride: current("vendorDueOverride"), vendorShippingCostOverride: current("vendorShippingCostOverride"), warehouseCostOverride: current("warehouseCostOverride"),
      };
      await this.repo.setLineOverrides(line.id, next, transaction);
      const totals = await this.recomputeTotals(invoice.id, transaction);
      await this.repo.insertEvent({
        action: "line.overridden", actorId: actor.id,
        detail: {
          lineId, orderId: Number(line.orderId), orderNumber: line.orderNumber, operationNumber: line.operationNumber, reason: patch.reason ?? null,
          // only the fields this request touched, old -> new (null = automatic value)
          changes: Object.fromEntries((Object.keys(before) as Key[]).filter((key) => patch[key] !== undefined).map((key) => [key, { from: before[key], to: next[key] }])),
          from: before, to: next, netAmount: totals.netAmount,
        },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return { line: this.toLineDto((await this.repo.findLine(invoice.id, lineId, transaction))!), netAmount: totals.netAmount };
    });
  }

  /** Shared by the invoice dialog and the live rows: the caller already holds the locked, draft-checked invoice. */
  private async applyLineAction(invoice: InvoiceRow, line: LineRow, action: LineAction, reason: string | undefined, actor: Actor, transaction: Tx) {
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
      detail: { fromState: line.state, lineId: Number(line.id), netAmount: totals.netAmount, orderId: Number(line.orderId), orderNumber: line.orderNumber, reason: reason ?? null, toState: rule.to },
      invoiceId: invoice.id, vendorId: invoice.vendorId,
    }, transaction);
    return { netAmount: totals.netAmount, state: rule.to };
  }

  public async lineAction(id: number, lineId: number, action: LineAction, reason: string | undefined, actor: Actor) {
    return this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      this.assertDraft(invoice);
      const line = await this.repo.findLine(invoice.id, lineId, transaction);
      if (!line) throw new NotFoundError("الطلب غير موجود في الفاتورة");
      return this.applyLineAction(invoice, line, action, reason, actor, transaction);
    });
  }

  /* ---------- live-row actions (create the draft first, act in the same transaction) ---------- */

  /** (vendor, cycle) draft from the live report, created if missing. Concurrent callers converge on one row (upsertDraft ON CONFLICT). */
  public async ensureLiveDraft(input: LiveDraftInput, actor: Actor) {
    const report = await this.getReport({ billingDay: input.billingDay, referenceDate: input.referenceDate, vendorId: input.vendorId }, input.vendorId);
    const snapshots = this.snapshotsByVendor(report).get(input.vendorId) ?? [];
    const ensured = await this.repo.transaction((transaction) => this.ensureDraft(report.cycle, input.vendorId, snapshots, actor, transaction));
    return { cycle: report.cycle, ...ensured };
  }

  /** Freeze / unfreeze / defer (move to the next cycle) / delete / restore one order straight from the live row. */
  public async liveLineAction(input: LiveDraftInput & { action: LineAction; orderId: number; reason?: string }, actor: Actor) {
    const report = await this.getReport({ billingDay: input.billingDay, referenceDate: input.referenceDate, vendorId: input.vendorId }, input.vendorId);
    const snapshots = this.snapshotsByVendor(report).get(input.vendorId) ?? [];
    return this.repo.transaction(async (transaction) => {
      const { created, invoiceId } = await this.ensureDraft(report.cycle, input.vendorId, snapshots, actor, transaction);
      const invoice = await this.mustFind(invoiceId, transaction);
      this.assertDraft(invoice);
      const line = await this.repo.findLineByOrder(invoice.id, input.orderId, transaction);
      if (!line) throw new ConflictError("هذا الطلب غير مضمّن في فاتورة الدورة (مفوتَر في فاتورة أخرى أو محذوف نهائيًا)");
      const result = await this.applyLineAction(invoice, line, input.action, input.reason, actor, transaction);
      return { ...result, created, invoiceId: Number(invoice.id) };
    });
  }

  public async orderCandidates(id: number, q: string) {
    const invoice = await this.repo.findInvoice(id);
    if (!invoice) throw new NotFoundError("الفاتورة غير موجودة");
    return this.repo.searchOrderCandidates(Number(invoice.vendorId), q);
  }

  private async insertOrderLine(invoice: InvoiceRow, snapshot: LineSnapshot, actor: Actor, transaction: Tx) {
    const added = await this.repo.insertLines(invoice.id, [snapshot], actor.id, transaction);
    if (added.length === 0) throw new ConflictError("هذا الطلب موجود بالفعل في فاتورة أخرى أو تم حذفه نهائيًا من الفواتير");
    const totals = await this.recomputeTotals(invoice.id, transaction);
    await this.repo.insertEvent({
      action: "line.added", actorId: actor.id, detail: { netAmount: totals.netAmount, orderId: snapshot.orderId, orderNumber: snapshot.orderNumber },
      invoiceId: invoice.id, vendorId: invoice.vendorId,
    }, transaction);
    return { netAmount: totals.netAmount };
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
      return this.insertOrderLine(invoice, snapshot, actor, transaction);
    });
  }

  /** Order picker for the live rows: same search as the dialog, but keyed by vendor (no invoice needed yet). */
  public liveOrderCandidates(vendorId: number, q: string) {
    return this.repo.searchOrderCandidates(vendorId, q);
  }

  /** «إضافة طلب» from the live vendor section: create the draft if missing, then add the order in the same transaction. Idempotent. */
  public async liveAddOrder(input: LiveDraftInput & { orderId: number }, actor: Actor) {
    const snapshot = await this.repo.transaction((transaction) => this.lookupSnapshot(input.orderId, input.vendorId, transaction));
    if (!snapshot) throw new ConflictError("الطلب غير مسلّم أو لا يخص هذا البائع");
    const report = await this.getReport({ billingDay: input.billingDay, referenceDate: input.referenceDate, vendorId: input.vendorId }, input.vendorId);
    const snapshots = this.snapshotsByVendor(report).get(input.vendorId) ?? [];
    return this.repo.transaction(async (transaction) => {
      const { created, invoiceId } = await this.ensureDraft(report.cycle, input.vendorId, snapshots, actor, transaction);
      const invoice = await this.mustFind(invoiceId, transaction);
      this.assertDraft(invoice);
      // the draft top-up may already have pulled this very order in (it belongs to the cycle): that is the requested end state
      const existing = await this.repo.findLineByOrder(invoice.id, input.orderId, transaction);
      if (existing) {
        if (existing.state !== LINE_STATE.INCLUDED) throw new ConflictError("هذا الطلب موجود في الفاتورة بحالة غير محسوبة — استخدم قائمة الطلب لإرجاعه");
        const totals = await this.recomputeTotals(invoice.id, transaction);
        return { alreadyIncluded: true, created, invoiceId: Number(invoice.id), netAmount: totals.netAmount };
      }
      return { alreadyIncluded: false, created, invoiceId: Number(invoice.id), ...(await this.insertOrderLine(invoice, snapshot, actor, transaction)) };
    });
  }

  /* ---------- consolidated invoices («فاتورة شاملة») ---------- */

  /** Arabic reason why an invoice cannot be merged right now, or null when it can. */
  private mergeBlockReason(row: InvoiceRow): string | null {
    const label = row.code ?? `#${row.id}`;
    if ((row.kind ?? INVOICE_KIND.STANDARD) === INVOICE_KIND.CONSOLIDATED) return `الفاتورة ${label} فاتورة شاملة بالفعل ولا يمكن دمجها`;
    if (row.status === INVOICE_STATUS.CONSOLIDATED || (row.mergedIntoId !== null && row.mergedIntoId !== undefined)) {
      return `الفاتورة ${label} مدمجة بالفعل في فاتورة شاملة`;
    }
    if (!MERGEABLE_STATUSES.includes(row.status)) {
      return `الفاتورة ${label} حالتها «${INVOICE_STATUS_LABELS[row.status] ?? row.status}» — يُدمج فقط «معلّقة» أو «تمت المراجعة»`;
    }
    if (this.receiptsCountOf(row) > 0) return `الفاتورة ${label} عليها إيصال تحويل`;
    if (row.transferredAt || (row.transferAmount !== null && row.transferAmount !== undefined)) return `الفاتورة ${label} عليها بيانات تحويل`;
    return null;
  }

  private toSourceDto(row: InvoiceRow) {
    const net = num(row.netAmount);
    return {
      billingDay: row.billingDay,
      code: row.code,
      dueParty: dueParty(net),
      id: Number(row.id),
      month: moment.tz(row.periodEnd, CAIRO).format("YYYY-MM"),
      netAmount: net,
      ordersCount: Number(row.ordersCount),
      periodEnd: iso(row.periodEnd),
      periodStart: iso(row.periodStart),
      status: row.preMergeStatus ?? row.status,
    };
  }

  /** `<base>-ALL`, then `-ALL2`, `-ALL3` … the first free one. */
  private pickConsolidatedCode(base: string, taken: string[]): string {
    const used = new Set(taken);
    const first = `${base}${CONSOLIDATED_CODE_SUFFIX}`;
    if (!used.has(first)) return first;
    for (let n = 2; ; n += 1) {
      const candidate = `${first}${n}`;
      if (!used.has(candidate)) return candidate;
    }
  }

  /**
   * Merges ≥ 2 open invoices (draft/reviewed) of one vendor into ONE consolidated invoice so opposite balances offset in a single signed net.
   * Lines and adjustments MOVE (orders stay unique), each keeping its `sourceInvoiceId`; the sources become `consolidated`.
   * Everything runs in one transaction under row locks on all the sources (ascending id), so two concurrent merges / a review / a transfer
   * of one of them cannot interleave: the loser re-reads the locked row and gets a 409.
   */
  public async consolidate(invoiceIds: number[], actor: Actor) {
    const ids = [...new Set(invoiceIds.map(Number))].sort((a, b) => a - b);
    if (ids.length < 2) throw new ValidationError("اختر فاتورتين على الأقل");
    return this.repo.transaction(async (transaction) => {
      const locked = await this.repo.lockInvoices(ids, transaction);
      if (locked.length !== ids.length) throw new NotFoundError("إحدى الفواتير المختارة غير موجودة");
      const vendorIds = new Set(locked.map((row) => Number(row.vendorId)));
      if (vendorIds.size > 1) throw new ConflictError("لا يمكن دمج فواتير بائعين مختلفين — اختر فواتير بائع واحد");
      const reasons = locked.map((row) => this.mergeBlockReason(row)).filter((reason): reason is string => reason !== null);
      if (reasons.length > 0) throw new ConflictError(reasons.join("؛ "));

      const latest = [...locked].sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime() || Number(b.id) - Number(a.id))[0]!;
      const vendorId = Number(latest.vendorId);
      let base = latest.code;
      if (!base) {
        const sequence = await this.repo.nextInvoiceSequence(transaction);
        base = `INV-${moment.tz(this.now(), CAIRO).format("YYYY")}-${String(sequence).padStart(4, "0")}`;
      }
      const code = this.pickConsolidatedCode(base, await this.repo.listCodesWithPrefix(`${base}${CONSOLIDATED_CODE_SUFFIX}`, transaction));
      const target = await this.repo.insertConsolidated({
        billingDay: latest.billingDay, code, createdBy: actor.id, periodEnd: latest.periodEnd, periodStart: latest.periodStart, vendorId,
      }, transaction);
      const moved = await this.repo.moveToConsolidated(ids, target.id, transaction);
      await this.repo.markMerged(ids, { mergedCode: code, mergedIntoId: target.id }, transaction);
      const totals = await this.recomputeTotals(target.id, transaction);
      const sources = locked.map((row) => this.toSourceDto(row));
      await this.repo.insertEvent({
        action: "invoice.consolidated", actorId: actor.id,
        detail: { adjustments: moved.adjustments, code, lines: moved.lines, netAmount: totals.netAmount, sources },
        invoiceId: target.id, toStatus: INVOICE_STATUS.DRAFT, vendorId,
      }, transaction);
      for (const row of locked) {
        await this.repo.insertEvent({
          action: "invoice.consolidated", actorId: actor.id, detail: { consolidatedCode: code, consolidatedId: Number(target.id), netAmount: num(row.netAmount) },
          fromStatus: row.status, invoiceId: row.id, toStatus: INVOICE_STATUS.CONSOLIDATED, vendorId,
        }, transaction);
      }
      const invoice = (await this.repo.findInvoice(target.id, transaction))!;
      return { invoice: this.toInvoiceDto(invoice), sources: locked.map((row) => ({ ...this.toSourceDto(row), mergedCode: code })) };
    });
  }

  /**
   * Undo a merge while the consolidated invoice is still draft/reviewed with no receipt/transfer: lines and adjustments go back to their
   * source invoices, the sources get their previous status back and the consolidated invoice is cancelled (kept for the audit trail).
   */
  public async unconsolidate(id: number, actor: Actor) {
    return this.repo.transaction(async (transaction) => {
      const target = await this.mustFind(id, transaction);
      if (target.kind !== INVOICE_KIND.CONSOLIDATED || target.status === INVOICE_STATUS.CANCELLED) throw new ConflictError("هذه ليست فاتورة شاملة قائمة");
      if (!MERGEABLE_STATUSES.includes(target.status)) {
        throw new ConflictError(`لا يمكن فك الدمج: الفاتورة الشاملة حالتها «${INVOICE_STATUS_LABELS[target.status] ?? target.status}»`);
      }
      if (this.receiptsCountOf(target) > 0 || target.transferredAt || (target.transferAmount !== null && target.transferAmount !== undefined)) {
        throw new ConflictError("لا يمكن فك الدمج: عليها إيصال أو بيانات تحويل");
      }
      const sources = await this.repo.lockMergedSources(target.id, transaction);
      if (sources.length === 0) throw new ConflictError("لا توجد فواتير مجمّعة لفكّها");
      const fallback = [...sources].sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime() || Number(b.id) - Number(a.id))[0]!;
      const before = num(target.netAmount);
      const fromStatus = target.status;
      const consolidatedCode = target.code;
      await this.repo.moveBackFromConsolidated(target.id, fallback.id, transaction);
      const restored: Array<{ code: string | null; id: number; netAfter: number; netBefore: number; status: InvoiceStatus }> = [];
      for (const source of sources) {
        const status = (source.preMergeStatus ?? INVOICE_STATUS.DRAFT) as InvoiceStatus;
        await this.repo.restoreMerged(source.id, status, transaction);
        const totals = await this.recomputeTotals(source.id, transaction);
        restored.push({ code: source.code, id: Number(source.id), netAfter: totals.netAmount, netBefore: num(source.netAmount), status });
        await this.repo.insertEvent({
          action: "invoice.unconsolidated", actorId: actor.id, detail: { consolidatedCode, consolidatedId: Number(target.id), netAfter: totals.netAmount, netBefore: num(source.netAmount) },
          fromStatus: INVOICE_STATUS.CONSOLIDATED, invoiceId: source.id, toStatus: status, vendorId: source.vendorId,
        }, transaction);
      }
      await this.repo.cancelConsolidated(target.id, transaction);
      await this.recomputeTotals(target.id, transaction);
      await this.repo.insertEvent({
        action: "invoice.unconsolidated", actorId: actor.id, detail: { code: consolidatedCode, netBeforeUndo: before, restored },
        fromStatus, invoiceId: target.id, toStatus: INVOICE_STATUS.CANCELLED, vendorId: target.vendorId,
      }, transaction);
      return { restored, cancelledId: Number(target.id) };
    });
  }

  /* ---------- receipts (several per invoice) ---------- */

  private toReceiptDto(row: ReceiptRow, scope: Scope) {
    return {
      id: Number(row.id), mime: row.mime, name: row.name, size: row.size === null || row.size === undefined ? null : Number(row.size),
      uploadedAt: iso(row.uploadedAt),
      // who uploaded is internal
      ...(scope.vendorId ? {} : { uploadedBy: row.uploadedBy }),
    };
  }

  /**
   * Receipts of an invoice in upload order. A legacy single receipt (receiptPath & friends) that is not a row of the receipts table yet
   * (the migration backfills it; this covers a deploy window) is returned first with id 0.
   */
  private async collectReceipts(invoice: InvoiceRow, transaction?: Tx): Promise<ReceiptRow[]> {
    const rows = await this.repo.listReceipts(invoice.id, transaction);
    if (invoice.receiptPath && !rows.some((row) => row.path === invoice.receiptPath)) {
      return [{
        id: 0, invoiceId: invoice.id, mime: invoice.receiptMime ?? receiptMimeFor(invoice.receiptName ?? ""), name: invoice.receiptName ?? "receipt", path: invoice.receiptPath,
        size: null, uploadedAt: invoice.receiptUploadedAt ?? invoice.createdAt, uploadedBy: null,
      }, ...rows];
    }
    return rows;
  }

  /** Turns the legacy single receipt into a real row (under the invoice lock) so it can be removed like any other. */
  private async materializeLegacyReceipt(invoice: InvoiceRow, transaction: Tx): Promise<void> {
    if (!invoice.receiptPath) return;
    const rows = await this.repo.listReceipts(invoice.id, transaction);
    if (!rows.some((row) => row.path === invoice.receiptPath)) {
      await this.repo.insertReceipt(invoice.id, {
        mime: invoice.receiptMime ?? receiptMimeFor(invoice.receiptName ?? ""), name: invoice.receiptName ?? "receipt", path: invoice.receiptPath,
        size: null, uploadedAt: invoice.receiptUploadedAt ? new Date(invoice.receiptUploadedAt) : this.now(), uploadedBy: null,
      }, transaction);
    }
  }

  /** Vendors: own TRANSFERRED invoices only (same rule as the single receipt had). */
  private assertReceiptReadable(invoice: InvoiceRow | null, scope: Scope): InvoiceRow {
    const readable = this.assertReadable(invoice, scope);
    if (scope.vendorId && readable.status !== INVOICE_STATUS.TRANSFERRED) throw new ForbiddenError("Forbidden");
    return readable;
  }

  public async listReceipts(id: number, scope: Scope) {
    const invoice = this.assertReceiptReadable(await this.repo.findInvoice(id), scope);
    return (await this.collectReceipts(invoice)).map((row) => this.toReceiptDto(row, scope));
  }

  /**
   * Adds one or more receipts (files already stored by the upload middleware). Only on a transferred invoice.
   * On ANY failure the freshly stored files are deleted so nothing is orphaned.
   */
  public async addReceipts(id: number, files: ReceiptFile[], actor: Actor) {
    try {
      if (files.length === 0) throw new ValidationError("الملف مطلوب");
      if (files.length > MAX_RECEIPTS_PER_UPLOAD) throw new ValidationError(`الحد الأقصى ${MAX_RECEIPTS_PER_UPLOAD} ملفات في المرة الواحدة`);
      const sizes = await Promise.all(files.map((file) => this.statStoredFile(file.path)));
      return await this.repo.transaction(async (transaction) => {
        const invoice = await this.mustFind(id, transaction);
        if (invoice.status !== INVOICE_STATUS.TRANSFERRED) throw new ConflictError("لا يمكن رفع إيصال إلا لفاتورة «تم التحويل»");
        const existing = await this.collectReceipts(invoice, transaction);
        if (existing.length + files.length > MAX_RECEIPTS_PER_INVOICE) {
          throw new ConflictError(`الحد الأقصى ${MAX_RECEIPTS_PER_INVOICE} إيصال للفاتورة الواحدة`);
        }
        await this.materializeLegacyReceipt(invoice, transaction);
        const uploadedAt = this.now();
        const added: ReceiptRow[] = [];
        for (const [index, file] of files.entries()) {
          added.push(await this.repo.insertReceipt(invoice.id, {
            mime: receiptMimeFor(file.name), name: file.name, path: file.path, size: sizes[index] ?? null, uploadedAt, uploadedBy: actor.id,
          }, transaction));
        }
        await this.repo.insertEvent({
          action: "receipt.uploaded", actorId: actor.id,
          detail: { count: files.length, fileNames: files.map((file) => file.name), receiptIds: added.map((row) => Number(row.id)), total: existing.length + files.length },
          invoiceId: invoice.id, vendorId: invoice.vendorId,
        }, transaction);
        return { added: added.map((row) => this.toReceiptDto(row, {})), count: existing.length + files.length };
      });
    } catch (error) {
      await Promise.all(files.map((file) => this.removeStoredFile(file.path)));
      throw error;
    }
  }

  /** Removes one receipt (soft delete + file). Mirrors the single-receipt rule: only while the invoice is «تم التحويل». receiptId 0 = the legacy single receipt. */
  public async removeReceipt(id: number, receiptId: number, actor: Actor) {
    const removedPath = await this.repo.transaction(async (transaction) => {
      const invoice = await this.mustFind(id, transaction);
      if (invoice.status !== INVOICE_STATUS.TRANSFERRED) throw new ConflictError("لا يمكن حذف الإيصال إلا من فاتورة «تم التحويل»");
      if (receiptId === 0) await this.materializeLegacyReceipt(invoice, transaction);
      const receipt = receiptId === 0
        ? (await this.repo.listReceipts(invoice.id, transaction)).find((row) => row.path === invoice.receiptPath)
        : await this.repo.findReceipt(invoice.id, receiptId, transaction);
      if (!receipt) throw new NotFoundError("لا يوجد إيصال");
      await this.repo.softDeleteReceipt(receipt.id, actor.id, transaction);
      if (invoice.receiptPath && invoice.receiptPath === receipt.path) {
        await this.repo.updateInvoiceFields(invoice.id, { receiptMime: null, receiptName: null, receiptPath: null, receiptUploadedAt: null, receiptUploadedBy: null }, transaction);
      }
      await this.repo.insertEvent({
        action: "receipt.removed", actorId: actor.id, detail: { fileName: receipt.name, receiptId: Number(receipt.id) },
        invoiceId: invoice.id, vendorId: invoice.vendorId,
      }, transaction);
      return receipt.path;
    });
    await this.removeStoredFile(removedPath);
  }

  /** Authorises a receipt read (vendors: own transferred invoice only) and returns the file info. receiptId omitted/0 = the first receipt. */
  public async receiptFor(id: number, scope: Scope, receiptId?: number): Promise<{ absolutePath: string; mime: string; name: string }> {
    const invoice = this.assertReceiptReadable(await this.repo.findInvoice(id), scope);
    const receipts = await this.collectReceipts(invoice);
    const receipt = receiptId ? receipts.find((row) => Number(row.id) === receiptId) : receipts[0];
    if (!receipt) throw new NotFoundError("لا يوجد إيصال");
    return { absolutePath: resolveReceiptFile(receipt.path), mime: receipt.mime || "application/octet-stream", name: receipt.name || "receipt" };
  }
}
