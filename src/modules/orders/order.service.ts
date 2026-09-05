import { ConflictError, NotFoundError, UnauthorizedError } from "../../shared/errors";
import type { Result } from "../../shared/result";
import { success } from "../../shared/result";
import { DELIVERY_BY, USER_TYPES } from "../../../config/constants";
import { DashboardAggregateService } from "../dashboard/dashboard-aggregate.service";
import type { DashboardMetricSnapshot } from "../dashboard/dashboard.types";
import { orderLegacyGateway, type LegacyOrderGateway } from "./order.legacy-gateway";
import { normalizeOrderMutationPayload, toPlain, toText } from "./order.helpers";
import { OrderRepository } from "./order.repo";
import type { LegacyOrderResponse, OrderDetailsResponse, OrderFinancialReportQuery, OrderFinancialReportResponse, OrderListQuery, OrderListResponse, OrderMetaResponse, OrderMutationPayload, OrderRequestUser, OrderSummaryResponse } from "./order.types";
import type { Response } from "express";

// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const ExcelJS = require("exceljs");

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
  ) {}

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

  public async updateOrder(orderId: number, payload: OrderMutationPayload, user: OrderRequestUser): Promise<Result<unknown>> {
    const existingOrder = await this.orderRepository.findOrderEntity(orderId);
    const scopedPayload = restrictVendorOrderPayload(payload, user);
    const normalizedPayload = normalizeOrderMutationPayload(scopedPayload, toPlain(existingOrder));
    const response = ensureLegacySuccess(await this.legacyGateway.updateOrder(orderId, normalizedPayload, user));
    await this.refreshAggregateForDates([existingOrder ? this.getOrderDate(existingOrder) : null, normalizedPayload.orderDate, this.getOrderDate(response.data)]);
    return success(response.data ?? {});
  }

  public async bulkUpdate(
    payload: OrderMutationPayload,
    user: OrderRequestUser,
  ): Promise<Result<{ message: string }>> {
    const orderIds = Array.isArray(payload.orderIds) ? payload.orderIds.map(Number).filter(Boolean) : [];
    const orderData = { ...((payload.orderData as Record<string, unknown> | undefined) ?? {}) };
    delete orderData.shippedFromInventory;
    if (orderData.deliveryBy !== undefined && orderData.deliveryBy !== null && orderData.deliveryBy !== "") {
      orderData.shippedFromInventory = Number(orderData.deliveryBy) === DELIVERY_BY.HOMIX;
    }
    const existingOrders = await this.orderRepository.findOrderEntities(orderIds);
    const normalizedPayload = { ...payload, orderData };
    const response = ensureLegacySuccess(await this.legacyGateway.bulkUpdate(normalizedPayload, user));
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
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order Line not found");
    const note = await this.orderRepository.findNoteById(noteId);
    if (!note) throw new NotFoundError("Note not found");
    const noteRecord = note as { userId?: number | string };
    if (String(user.userType) === String(USER_TYPES.VENDOR) || String(user.id) !== String(noteRecord.userId)) {
      throw new UnauthorizedError("You are not authorized to update this note");
    }
    return success(await this.orderRepository.updateOrderNote(noteId, text));
  }

  public async deleteNote(orderId: number, noteId: number, user: OrderRequestUser): Promise<Result<{ message: string }>> {
    const order = await this.orderRepository.findOrderEntity(orderId);
    if (!order) throw new NotFoundError("Order Line not found");
    const note = await this.orderRepository.findNoteById(noteId);
    if (!note) throw new NotFoundError("Note not found");
    const noteRecord = note as { userId?: number | string };
    if (String(user.id) !== String(noteRecord.userId)) {
      throw new UnauthorizedError("You are not authorized to update this note");
    }
    await this.orderRepository.deleteOrderNote(noteId);
    return success({ message: "Note deleted successfully" });
  }

  public async uploadFiles(
    noteId: number,
    filePaths: string[],
    fileNames: string[],
    descriptions: string[],
  ): Promise<Result<{ message: string }>> {
    const note = await this.orderRepository.findNoteById(noteId);
    if (!note) throw new NotFoundError("Note not found");
    await this.orderRepository.createNoteAttachments(noteId, filePaths, fileNames, descriptions);
    return success({ message: "Files uploaded!" });
  }

  public async exportOrders(response: unknown, payload: OrderMutationPayload): Promise<void> {
    await this.legacyGateway.exportOrders(response, payload);
  }

  public async exportFinancialReport(response: Response, query: OrderFinancialReportQuery, vendorId?: number | null): Promise<void> {
    const report = await this.orderRepository.getFinancialReport(query, vendorId);
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
      { label: "مستحق الشركة", value: report.summary.companyDue },
      { label: "الغرامات", value: report.summary.fines },
      { label: "عدد البائعين", value: report.summary.vendorsCount },
    ].forEach((row) => {
      summarySheet.addRow(row);
    });
    summarySheet.commit();

    const addSectionSheet = (
      name: string,
      section: OrderFinancialReportResponse["fullInvoice"],
    ): void => {
      const worksheet = workbook.addWorksheet(name);
      worksheet.columns = [
        { header: "البائع", key: "vendorName", width: 28 },
        { header: "عدد الطلبات", key: "ordersCount", width: 18 },
        { header: "إجمالي التحصيل", key: "collectionTotal", width: 18 },
        { header: "مستحق البائع", key: "vendorDue", width: 18 },
        { header: "مستحق الشركة", key: "companyDue", width: 18 },
        { header: "تكلفة المخزن", key: "warehouseCost", width: 18 },
        { header: "الغرامات", key: "fines", width: 18 },
      ];

      section.items.forEach((item) => worksheet.addRow(item));
      worksheet.addRow({});
      worksheet.addRow({
        collectionTotal: section.summary.collectionTotal,
        companyDue: section.summary.companyDue,
        fines: section.summary.fines,
        ordersCount: section.summary.ordersCount,
        vendorDue: section.summary.vendorDue,
        vendorName: "الإجمالي",
        warehouseCost: section.summary.warehouseCost,
      });
      worksheet.commit();
    };

    addSectionSheet("full-invoice", report.fullInvoice);
    addSectionSheet("vendor-deliveries", report.vendorDeliveries);
    addSectionSheet("warehouse-deliveries", report.warehouseDeliveries);

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
