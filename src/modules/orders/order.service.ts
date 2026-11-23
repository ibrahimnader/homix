import { AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../../shared/errors";
import type { Result } from "../../shared/result";
import { success } from "../../shared/result";
import { DELIVERY_BY, USER_TYPES } from "../../../config/constants";
import { DashboardAggregateService } from "../dashboard/dashboard-aggregate.service";
import type { DashboardMetricSnapshot } from "../dashboard/dashboard.types";
import { orderLegacyGateway, type LegacyOrderGateway } from "./order.legacy-gateway";
import { normalizeOrderMutationPayload, toNumber, toPlain, toText } from "./order.helpers";
import { OrderRepository } from "./order.repo";
import { assertFinancialEditAllowed } from "./order-financial-guard";
import {
  buildRegressionAuditEntry, buildRegressionMessage, CONFIRM_REGRESSION_FIELD, findOrderRegressions, REGRESSION_AUDIT_ACTION,
  REGRESSION_FORBIDDEN_CODE, REGRESSION_NEEDS_CONFIRMATION_CODE, type OrderRegression,
} from "./order-regression-guard";
import type { LegacyOrderResponse, OrderDetailsResponse, OrderFinancialReportQuery, OrderFinancialReportResponse, OrderListQuery, OrderListResponse, OrderMetaResponse, OrderMutationPayload, OrderRequestUser, OrderSummaryResponse } from "./order.types";
import { liveExportReport as toLiveExportReport, LINE_STATE_LABELS, type ExportReport } from "../financial-invoices/invoice.export-overlay";
import type { Response } from "express";

// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const ExcelJS = require("exceljs");

export type FinancialReportOverlay = {
  effectiveReport(report: OrderFinancialReportResponse, scope: { vendorId?: number | null }, vendorId?: number): Promise<ExportReport>;
};

const ensureLegacySuccess = <TData>(response: LegacyOrderResponse<TData>): LegacyOrderResponse<TData> => {
  if (response.status !== false) {
    return response;
  }

  const message = response.message ?? "Order operation failed";
  if (response.statusCode === 404) throw new NotFoundError(message);
  if (response.statusCode === 403) throw new UnauthorizedError(message);
  throw new ConflictError(message);
};

/**
 * A vendor may only report progress on their own manufacturing. Order status,
 * delay status, priority, assignee, delivery-by and every financial field are
 * decided by Homix, so they are dropped from a vendor's payload rather than
 * merely hidden in the UI — otherwise the request could be replayed by hand.
 */
const VENDOR_EDITABLE_ORDER_FIELDS = new Set(["manufactureStatus", "notes"]);

export const restrictVendorOrderPayload = (
  payload: OrderMutationPayload,
  user: OrderRequestUser,
): OrderMutationPayload => {
  if (String(user?.userType) !== String(USER_TYPES.VENDOR)) {
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([field]) => VENDOR_EDITABLE_ORDER_FIELDS.has(field)),
  ) as OrderMutationPayload;
};

export {
  ORDER_FINANCIAL_EDIT_PERMISSION,
  assertFinancialEditAllowed,
  canEditOrderFinancials,
} from "./order-financial-guard";

const isVendorUser = (user: OrderRequestUser | undefined): boolean => String(user?.userType) === String(USER_TYPES.VENDOR);

export class OrderService {
  private readonly dashboardAggregateService = new DashboardAggregateService({
    getDeliveredOrdersCountFromOrders: async () => 0,
    getSnapshotFromOrders: async (): Promise<DashboardMetricSnapshot> => ({
      activeMakers: 0,
      activeProducts: 0,
      pendingOrders: 0,
      totalOrders: 0,
      totalSales: 0,
    }),
  });

  public constructor(
    private readonly orderRepository: OrderRepository,
    private readonly legacyGateway: LegacyOrderGateway = orderLegacyGateway,
    /** Lays the cycle's invoices over the live report for the Excel export (InvoiceService.effectiveReport). */
    private readonly invoiceOverlay?: FinancialReportOverlay,
  ) {}

  /**
   * A vendor may only touch orders containing one of their own products. Anything
   * else — missing or someone else's — is a plain 404, so existence never leaks
   * (same convention as getOrderById). With several ids ALL must be owned: one
   * foreign id rejects the whole request before anything is written. Staff pass.
   */
  private async assertVendorOwnsOrders(orderIds: number[], user: OrderRequestUser): Promise<void> {
    if (!isVendorUser(user)) return;
    const uniqueIds = [...new Set(orderIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const vendorId = Number((user as { vendorId?: unknown }).vendorId);
    if (uniqueIds.length === 0) return;
    if (!vendorId) throw new NotFoundError("Order not found");
    const owned = await this.orderRepository.findVendorOwnedOrderIds(uniqueIds, vendorId);
    if (owned.length !== uniqueIds.length) throw new NotFoundError("Order not found");
  }

  public async listOrders(filters: OrderListQuery, vendorId?: number | null): Promise<Result<OrderListResponse>> {
    return success(await this.orderRepository.listOrders(filters, vendorId));
  }

  public async getSummary(filters: OrderListQuery, vendorId?: number | null): Promise<Result<OrderSummaryResponse>> {
    return success(await this.orderRepository.getSummary(filters, vendorId));
  }

  public async getMeta(): Promise<Result<OrderMetaResponse>> {
    return success(await this.orderRepository.getMeta());
  }

  public async getOrderById(orderId: number, vendorId?: number | null): Promise<Result<OrderDetailsResponse>> {
    const order = await this.orderRepository.getOrderById(orderId, vendorId);
    if (!order) throw new NotFoundError("Order not found");
    return success(order);
  }

  public async createOrder(payload: OrderMutationPayload, user?: OrderRequestUser): Promise<Result<{ message: string }>> {
    if (user && String(user.userType) === String(USER_TYPES.VENDOR)) throw new ForbiddenError("البائع لا يملك صلاحية إنشاء الطلبات");
    const normalizedPayload = normalizeOrderMutationPayload(payload);
    await this.legacyGateway.saveImportedOrders([normalizedPayload], false, user);
    await this.refreshAggregateForDates([normalizedPayload.orderDate]);
    return success({ message: "Order created successfully" });
  }

  public async importOrders(): Promise<Result<{ message: string }>> {
    await this.legacyGateway.importOrders();
    await this.dashboardAggregateService.backfill();
    return success({ message: "Orders imported successfully" });
  }

  public async financialReport(query: OrderFinancialReportQuery, vendorId?: number | null): Promise<Result<OrderFinancialReportResponse>> {
    return success(await this.orderRepository.getFinancialReport(query, vendorId));
  }

  /**
   * Regression safety net (see order-regression-guard): refuses 409 when the edit would move a delivered / returned / replaced /
   * in-inventory or invoiced order backwards and the request does not carry confirmRegression; vendors are refused 403 outright.
   * Returns the confirmed regressions so the caller can audit them after the write succeeds.
   */
  private async assertRegressionConfirmed(
    orders: unknown[],
    data: Record<string, unknown>,
    confirmRegression: boolean,
    user: OrderRequestUser,
  ): Promise<OrderRegression[]> {
    const regressions = await findOrderRegressions(orders, data, (ids) => this.orderRepository.findInvoiceLockedOrders(ids));
    if (regressions.length === 0) return [];
    const message = buildRegressionMessage(regressions);
    if (isVendorUser(user)) throw new AppError(message, 403, REGRESSION_FORBIDDEN_CODE, { regressions });
    if (!confirmRegression) throw new AppError(message, 409, REGRESSION_NEEDS_CONFIRMATION_CODE, { regressions });
    return regressions;
  }

  private async auditConfirmedRegressions(regressions: OrderRegression[], user: OrderRequestUser): Promise<void> {
    for (const regression of regressions) {
      await this.orderRepository.createOrderLog({
        action: REGRESSION_AUDIT_ACTION,
        entityId: regression.orderId,
        entityType: "order",
        userId: Number(user.id),
        ...buildRegressionAuditEntry(regression),
      });
    }
  }

  public async updateOrder(orderId: number, rawPayload: OrderMutationPayload, user: OrderRequestUser): Promise<Result<unknown>> {
    await this.assertVendorOwnsOrders([orderId], user);
    const { [CONFIRM_REGRESSION_FIELD]: confirmFlag, ...payload } = rawPayload as Record<string, unknown>;
    const confirmRegression = !isVendorUser(user) && (confirmFlag === true || confirmFlag === "true");
    const existingOrder = await this.orderRepository.findOrderEntity(orderId);
    const scopedPayload = restrictVendorOrderPayload(payload as OrderMutationPayload, user);
    assertFinancialEditAllowed(payload as Record<string, unknown>, user, existingOrder ? toPlain(existingOrder) : null);
    const normalizedPayload = normalizeOrderMutationPayload(scopedPayload, toPlain(existingOrder));
    const confirmedRegressions = existingOrder
      ? await this.assertRegressionConfirmed([existingOrder], normalizedPayload as Record<string, unknown>, confirmRegression, user)
      : [];
    const response = ensureLegacySuccess(await this.legacyGateway.updateOrder(orderId, normalizedPayload, user));
    await this.auditConfirmedRegressions(confirmedRegressions, user);
    await this.refreshAggregateForDates([existingOrder ? this.getOrderDate(existingOrder) : null, normalizedPayload.orderDate, this.getOrderDate(response.data)]);
    return success(response.data ?? {});
  }

  public async bulkUpdate(
    rawPayload: OrderMutationPayload,
    user: OrderRequestUser,
  ): Promise<Result<{ message: string }>> {
    const { [CONFIRM_REGRESSION_FIELD]: topLevelFlag, ...payload } = rawPayload as Record<string, unknown>;
    const orderIds = Array.isArray(payload.orderIds) ? payload.orderIds.map(Number).filter(Boolean) : [];
    await this.assertVendorOwnsOrders(orderIds, user);
    const { [CONFIRM_REGRESSION_FIELD]: nestedFlag, ...rawOrderData } = { ...((payload.orderData as Record<string, unknown> | undefined) ?? {}) };
    const confirmRegression = !isVendorUser(user)
      && [topLevelFlag, nestedFlag].some((flag) => flag === true || flag === "true");
    assertFinancialEditAllowed(rawOrderData, user, null);
    /* Same vendor whitelist as the single-order update: a vendor may only change manufactureStatus/notes. */
    const orderData = restrictVendorOrderPayload(rawOrderData as OrderMutationPayload, user) as Record<string, unknown>;
    delete orderData.shippedFromInventory;
    if (orderData.deliveryBy !== undefined && orderData.deliveryBy !== null && orderData.deliveryBy !== "") {
      orderData.shippedFromInventory = Number(orderData.deliveryBy) === DELIVERY_BY.HOMIX;
    }
    const existingOrders = await this.orderRepository.findOrderEntities(orderIds);
    const normalizedPayload = { ...payload, orderData };
    const confirmedRegressions = await this.assertRegressionConfirmed(existingOrders, orderData, confirmRegression, user);
    const response = ensureLegacySuccess(await this.legacyGateway.bulkUpdate(normalizedPayload, user));
    await this.auditConfirmedRegressions(confirmedRegressions, user);
    const nextOrderDate = this.getBulkOrderDate(normalizedPayload);
    await this.refreshAggregateForDates([
      ...existingOrders.map((order) => this.getOrderDate(order)),
      nextOrderDate,
    ]);
    return success({ message: response.message ?? "Orders updated successfully" });
  }

  public async deleteOrder(orderId: number, user: OrderRequestUser): Promise<Result<{ message: string }>> {
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order not found");
    await this.orderRepository.createOrderLog({
      action: "delete",
      entityId: orderId,
      entityType: "order",
      userId: Number(user.id),
    });
    await this.orderRepository.deleteOrder(orderId);
    await this.refreshAggregateForDates([this.getOrderDate(order)]);
    return success({ message: "Order deleted successfully" });
  }

  public async bulkDelete(payload: OrderMutationPayload): Promise<Result<{ message: string }>> {
    const orderIds = Array.isArray(payload.orderIds) ? payload.orderIds.map(Number).filter(Boolean) : [];
    const existingOrders = await this.orderRepository.findOrderEntities(orderIds);
    await this.orderRepository.bulkDelete(orderIds);
    await this.refreshAggregateForDates(existingOrders.map((order) => this.getOrderDate(order)));
    return success({ message: "Orders deleted successfully" });
  }

  public async addNote(orderId: number, text: string, user: OrderRequestUser): Promise<Result<unknown>> {
    await this.assertVendorOwnsOrders([orderId], user);
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order not found");
    const newNote = await this.orderRepository.createOrderNote(orderId, Number(user.id), text);
    const userRecord = user as OrderRequestUser & { firstName?: string; lastName?: string };
    await this.legacyGateway.sendNotification(
      orderId,
      toText((order as { orderNumber?: string }).orderNumber),
      {
        note: { text },
        orderId,
        type: "note",
        user: {
          firstName: userRecord.firstName,
          lastName: userRecord.lastName,
        },
      },
      false,
      true,
    );
    return success(newNote);
  }

  public async updateNote(orderId: number, noteId: number, text: string, user: OrderRequestUser): Promise<Result<unknown>> {
    await this.assertVendorOwnsOrders([orderId], user);
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order Line not found");
    const note = await this.orderRepository.findOrderNote(noteId, orderId);
    if (!note) throw new NotFoundError("Note not found");
    const noteRecord = note as { userId?: number | string };
    if (String(user.userType) === String(USER_TYPES.VENDOR) || String(user.id) !== String(noteRecord.userId)) {
      throw new UnauthorizedError("You are not authorized to update this note");
    }
    return success(await this.orderRepository.updateOrderNote(noteId, text));
  }

  public async deleteNote(orderId: number, noteId: number, user: OrderRequestUser): Promise<Result<{ message: string }>> {
    await this.assertVendorOwnsOrders([orderId], user);
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order Line not found");
    const note = await this.orderRepository.findOrderNote(noteId, orderId);
    if (!note) throw new NotFoundError("Note not found");
    const noteRecord = note as { userId?: number | string };
    if (String(user.id) !== String(noteRecord.userId)) {
      throw new UnauthorizedError("You are not authorized to update this note");
    }
    await this.orderRepository.deleteOrderNote(noteId);
    return success({ message: "Note deleted successfully" });
  }

  public async uploadFiles(
    orderId: number,
    noteId: number,
    filePaths: string[],
    fileNames: string[],
    descriptions: string[],
    user: OrderRequestUser,
  ): Promise<Result<{ message: string }>> {
    await this.assertVendorOwnsOrders([orderId], user);
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order not found");
    /* The note must be a regular note of THIS order: not a seller-chat message, not another order's note. */
    const note = await this.orderRepository.findOrderNote(noteId, orderId);
    if (!note) throw new NotFoundError("Note not found");
    await this.orderRepository.createNoteAttachments(noteId, filePaths, fileNames, descriptions);
    return success({ message: "Files uploaded!" });
  }

  public async listSellerChatMessages(orderId: number): Promise<Result<unknown[]>> {
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order not found");
    return success(await this.orderRepository.getSellerChatMessages(orderId));
  }

  public async addSellerChatMessage(orderId: number, text: string, user: OrderRequestUser): Promise<Result<unknown>> {
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order not found");
    return success(await this.orderRepository.createSellerChatMessage(orderId, Number(user.id), text));
  }

  public async uploadSellerChatFiles(
    orderId: number,
    messageId: number,
    filePaths: string[],
    fileNames: string[],
    descriptions: string[],
  ): Promise<Result<{ message: string }>> {
    const message = await this.orderRepository.findSellerChatMessageById(messageId, orderId);
    if (!message) throw new NotFoundError("Message not found");
    await this.orderRepository.createNoteAttachments(messageId, filePaths, fileNames, descriptions);
    return success({ message: "Files uploaded!" });
  }

  public async getSellerChatQuickReplies(): Promise<Result<Array<{ id: number; label: string }>>> {
    return success(await this.orderRepository.getSellerChatQuickReplies());
  }

  public async updateSellerChatQuickReplies(
    options: Array<{ id?: number; label: string }>,
  ): Promise<Result<Array<{ id: number; label: string }>>> {
    return success(await this.orderRepository.replaceSellerChatQuickReplies(options));
  }

  public async exportOrders(response: unknown, payload: OrderMutationPayload): Promise<void> {
    await this.legacyGateway.exportOrders(response, payload);
  }

  public async exportFinancialReport(response: Response, query: OrderFinancialReportQuery, vendorId?: number | null): Promise<void> {
    const liveReport = await this.orderRepository.getFinancialReport(query, vendorId);
    const staffVendor = Number(query.vendorId);
    // same numbers as the screen / PDF: invoice overrides, adjustments and line states laid over the live report
    const report = this.invoiceOverlay
      ? await this.invoiceOverlay.effectiveReport(liveReport, { vendorId: vendorId ?? null }, Number.isInteger(staffVendor) && staffVendor > 0 ? staffVendor : undefined)
      : toLiveExportReport(liveReport);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader("Content-Disposition", "attachment; filename=financial-report.xlsx");

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response });
    const summarySheet = workbook.addWorksheet("summary");
    summarySheet.columns = [
      { header: "البند", key: "label", width: 30 },
      { header: "القيمة", key: "value", width: 22 },
    ];
    [
      { label: "بداية الدورة", value: report.cycle.startDate },
      { label: "نهاية الدورة", value: report.cycle.endDate },
      { label: "نوع الدورة", value: report.cycle.mode },
      { label: "إجمالي المبيعات", value: report.summary.totalSales },
      { label: "مستحق البائعين", value: report.summary.vendorDue },
      { label: "المستحق لهوميكس", value: report.summary.companyDue },
      { label: "الغرامات", value: report.summary.fines },
      { label: "عدد البائعين", value: report.summary.vendorsCount },
    ].forEach((row) => {
      summarySheet.addRow(row);
    });
    summarySheet.commit();

    const addSectionSheet = (name: string, section: ExportReport["fullInvoice"], withAdjustments: boolean): void => {
      const worksheet = workbook.addWorksheet(name);
      worksheet.columns = [
        { header: "البائع", key: "vendorName", width: 28 },
        { header: "عدد الطلبات", key: "ordersCount", width: 18 },
        { header: "إجمالي التحصيل", key: "collectionTotal", width: 18 },
        { header: "مستحق البائع", key: "vendorDue", width: 18 },
        { header: "المستحق لهوميكس", key: "companyDue", width: 18 },
        { header: "سعر التكلفة", key: "warehouseCost", width: 18 },
        { header: "شحن البائع", key: "vendorShippingCost", width: 18 },
        { header: "الغرامات", key: "fines", width: 18 },
        ...(withAdjustments ? [
          { header: "التسويات اليدوية", key: "adjustmentsTotal", width: 18 },
          { header: "صافي مستحق البائع", key: "netAmount", width: 18 },
        ] : []),
        { header: "كود الفاتورة", key: "invoiceCode", width: 18 },
        { header: "حالة الفاتورة", key: "invoiceStatus", width: 18 },
      ];

      let adjustmentsTotal = 0;
      section.items.forEach((item) => {
        const adjustments = withAdjustments ? (item.invoice?.adjustmentsTotal ?? 0) : 0;
        adjustmentsTotal += adjustments;
        worksheet.addRow({
          ...item,
          adjustmentsTotal: withAdjustments ? adjustments : undefined,
          invoiceCode: item.invoice?.code ?? "",
          invoiceStatus: item.invoice?.statusLabel ?? "",
          netAmount: withAdjustments ? Math.round((item.vendorDue + adjustments) * 100) / 100 : undefined,
        });
      });
      worksheet.addRow({});
      worksheet.addRow({
        adjustmentsTotal: withAdjustments ? Math.round(adjustmentsTotal * 100) / 100 : undefined,
        collectionTotal: section.summary.collectionTotal,
        companyDue: section.summary.companyDue,
        fines: section.summary.fines,
        netAmount: withAdjustments ? Math.round((section.summary.vendorDue + adjustmentsTotal) * 100) / 100 : undefined,
        ordersCount: section.summary.ordersCount,
        vendorDue: section.summary.vendorDue,
        vendorName: "الإجمالي",
        vendorShippingCost: section.summary.vendorShippingCost,
        warehouseCost: section.summary.warehouseCost,
      });
      worksheet.commit();
    };

    addSectionSheet("full-invoice", report.fullInvoice, true);
    addSectionSheet("vendor-deliveries", report.vendorDeliveries, false);
    addSectionSheet("warehouse-deliveries", report.warehouseDeliveries, false);

    // order-level detail of the comprehensive tab: effective values, line state and «تعديل يدوي» marking
    const linesSheet = workbook.addWorksheet("lines");
    linesSheet.columns = [
      { header: "البائع", key: "vendorName", width: 28 },
      { header: "كود الفاتورة", key: "invoiceCode", width: 18 },
      { header: "حالة الفاتورة", key: "invoiceStatus", width: 16 },
      { header: "رقم العملية", key: "operationNumber", width: 18 },
      { header: "رقم الطلب", key: "orderNumber", width: 18 },
      { header: "كود المنتج", key: "productCode", width: 18 },
      { header: "حالة الدفع", key: "paymentStatusLabel", width: 16 },
      { header: "إجمالي التحصيل", key: "collectionTotal", width: 16 },
      { header: "سعر التكلفة", key: "warehouseCost", width: 16 },
      { header: "شحن البائع", key: "vendorShippingCost", width: 16 },
      { header: "الغرامات", key: "fines", width: 16 },
      { header: "مستحق البائع", key: "vendorDue", width: 16 },
      { header: "المستحق لهوميكس", key: "companyDue", width: 16 },
      { header: "حالة البند", key: "lineState", width: 16 },
      { header: "ملاحظات", key: "note", width: 40 },
    ];
    report.fullInvoice.items.forEach((item) => {
      item.exportOrders.forEach((order) => {
        const row = linesSheet.addRow({
          ...order,
          invoiceCode: item.invoice?.code ?? "",
          invoiceStatus: item.invoice?.statusLabel ?? "",
          lineState: order.state === "live" ? "" : LINE_STATE_LABELS[order.state],
          note: order.note ?? "",
          vendorName: item.vendorName,
        });
        // a manually edited cell carries the marking in its value's neighbour (notes) and a visible fill
        order.overridden.forEach((key) => {
          row.getCell(key).fill = { fgColor: { argb: "FFFFF2CC" }, pattern: "solid", type: "pattern" };
        });
      });
    });
    linesSheet.commit();

    // manual invoice adjustments (additions / deductions), one row each
    const adjustmentsSheet = workbook.addWorksheet("adjustments");
    adjustmentsSheet.columns = [
      { header: "البائع", key: "vendorName", width: 28 },
      { header: "كود الفاتورة", key: "invoiceCode", width: 18 },
      { header: "البيان", key: "label", width: 36 },
      { header: "النوع", key: "kind", width: 14 },
      { header: "المبلغ", key: "amount", width: 16 },
    ];
    report.fullInvoice.items.forEach((item) => {
      (item.invoice?.adjustments ?? []).forEach((adjustment) => {
        adjustmentsSheet.addRow({
          amount: adjustment.kind === "addition" ? adjustment.amount : -adjustment.amount,
          invoiceCode: item.invoice?.code ?? "",
          kind: adjustment.kind === "addition" ? "إضافة" : "خصم",
          label: adjustment.label,
          vendorName: item.vendorName,
        });
      });
    });
    adjustmentsSheet.commit();

    await workbook.commit();
    response.end();
  }

  private getBulkOrderDate(payload: OrderMutationPayload): unknown {
    const orderData = payload.orderData as Record<string, unknown> | undefined;
    return orderData?.orderDate;
  }

  private getOrderDate(order: unknown): unknown {
    if (!order || typeof order !== "object") {
      return null;
    }

    return (order as { orderDate?: unknown }).orderDate ?? null;
  }

  private normalizeDateOnly(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const parsedDate = value instanceof Date ? new Date(value) : new Date(String(value));
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate.toISOString().slice(0, 10);
  }

  private async refreshAggregateForDates(values: unknown[]): Promise<void> {
    const dates = values
      .map((value) => this.normalizeDateOnly(value))
      .filter((value): value is string => Boolean(value));

    if (dates.length === 0) {
      return;
    }

    const uniqueDates = [...new Set(dates)].sort((left, right) => left.localeCompare(right));
    await this.dashboardAggregateService.refreshRange(uniqueDates[0] ?? "", uniqueDates[uniqueDates.length - 1] ?? "");
  }
}
