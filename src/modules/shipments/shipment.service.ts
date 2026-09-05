import { NotFoundError, UnauthorizedError } from "../../shared/errors";
import type { Result } from "../../shared/result";
import { success } from "../../shared/result";
import type { Response } from "express";
import { shipmentLegacyGateway } from "./shipment.legacy-gateway";
import { ShipmentRepository } from "./shipment.repo";
import { normalizeOrderMutationPayload } from "../orders/order.helpers";
import type {
  DeliveryAccountsListQuery,
  DeliveryAccountsListResponse,
  ExpenseMutationInput,
  ExpenseAccountsListQuery,
  ExpenseAccountsListResponse,
  InventoryMutationInput,
  InventoryListQuery,
  InventoryListResponse,
  PerformanceQuery,
  PerformanceResponse,
  ReturnListQuery,
  ReturnListResponse,
  ReturnMutationInput,
  ShipmentDetailsResponse,
  ShipmentListQuery,
  ShipmentListResponse,
  ShipmentMetaResponse,
  ShippingCompanyItem,
  ShippingCompanyListResponse,
  ShippingCompanyMutationInput,
  ShipmentSummaryResponse,
} from "./shipment.types";
import type { ShipmentMutationPayload, ShipmentRequestUser } from "./shipment.internal-types";
import { RETURN_TO_VENDOR_STATUS, SHIPMENT_RETURN_TYPE } from "./shipment.constants";
import { DELIVERY_BY } from "../../../config/constants";
import { DashboardAggregateService } from "../dashboard/dashboard-aggregate.service";
import type { DashboardMetricSnapshot } from "../dashboard/dashboard.types";

// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const ExcelJS = require("exceljs");

export class ShipmentService {
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

  public constructor(private readonly shipmentRepository: ShipmentRepository) {}

  public async createShipment(payload: ShipmentMutationPayload): Promise<Result<{ message: string }>> {
    const normalizedPayload = await this.shipmentRepository.normalizeShippingCompanyPayload(payload);
    await shipmentLegacyGateway.createShipment({
      ...normalizeOrderMutationPayload({
        ...normalizedPayload,
        deliveryBy: DELIVERY_BY.HOMIX,
      }),
      deliveryBy: DELIVERY_BY.HOMIX,
      shippedFromInventory: true,
    });
    await this.refreshAggregateForShipments([payload]);
    return success({ message: "Shipment created successfully" });
  }

  public async getMeta(): Promise<Result<ShipmentMetaResponse>> {
    return success(await this.shipmentRepository.getMeta());
  }

  public async getSummary(filters: Omit<ShipmentListQuery, "page" | "size">, vendorId?: number | null): Promise<Result<ShipmentSummaryResponse>> {
    return success(await this.shipmentRepository.getSummary(filters, vendorId));
  }

  public async listShipments(filters: ShipmentListQuery, vendorId?: number | null): Promise<Result<ShipmentListResponse>> {
    return success(await this.shipmentRepository.listShipments(filters, vendorId));
  }

  public async getShipmentById(shipmentId: number, vendorId?: number | null): Promise<Result<ShipmentDetailsResponse>> {
    const shipment = await this.shipmentRepository.getShipmentById(shipmentId, vendorId);
    if (!shipment) {
      throw new NotFoundError("Shipment not found");
    }

    return success(shipment);
  }

  public async listVendorReturns(filters: ReturnListQuery, vendorId?: number | null): Promise<Result<ReturnListResponse>> {
    return success(await this.shipmentRepository.listVendorReturns(filters, vendorId));
  }

  public async listCustomerReturns(filters: ReturnListQuery, vendorId?: number | null): Promise<Result<ReturnListResponse>> {
    return success(await this.shipmentRepository.listCustomerReturns(filters, vendorId));
  }

  public async exportReturns(
    response: Response,
    type: "vendor" | "customer",
    filters: Omit<ReturnListQuery, "page" | "size">,
    vendorId?: number | null,
  ): Promise<void> {
    const report = type === "vendor"
      ? await this.shipmentRepository.listVendorReturns({ ...filters, page: 1, size: 1_000_000 }, vendorId)
      : await this.shipmentRepository.listCustomerReturns({ ...filters, page: 1, size: 1_000_000 }, vendorId);
    await this.writeAccountsWorkbook(response, `${type}-returns.xlsx`, `${type}-returns`, [
      { header: "رقم العملية", key: "operationNumber", width: 18 },
      { header: "رقم الطلب", key: "orderNumber", width: 18 },
      { header: "البائع", key: "sellerName", width: 24 },
      { header: "السبب", key: "reason", width: 40 },
      { header: "تاريخ الإرجاع", key: "returnDate", width: 22 },
      { header: "عدد الأيام", key: "daysCounter", width: 14 },
      { header: "نوع الإرجاع", key: "returnTypeLabel", width: 24 },
      { header: "الحالة", key: "statusLabel", width: 24 },
    ], report.items);
  }

  public async createVendorReturn(payload: ReturnMutationInput, user: ShipmentRequestUser): Promise<Result<ReturnListResponse["items"][number]>> {
    return success(await this.shipmentRepository.createReturnRecord(SHIPMENT_RETURN_TYPE.TO_VENDOR, payload, user.id));
  }

  public async createCustomerReturn(payload: ReturnMutationInput, user: ShipmentRequestUser): Promise<Result<ReturnListResponse["items"][number]>> {
    return success(await this.shipmentRepository.createReturnRecord(SHIPMENT_RETURN_TYPE.FROM_CUSTOMER, payload, user.id));
  }

  public async updateVendorReturn(
    returnId: number,
    payload: Partial<ReturnMutationInput>,
    user: ShipmentRequestUser,
  ): Promise<Result<ReturnListResponse["items"][number]>> {
    const existingReturn = await this.shipmentRepository.findReturnById(returnId, SHIPMENT_RETURN_TYPE.TO_VENDOR);
    if (existingReturn) {
      const plainReturn = "toJSON" in (existingReturn as Record<string, unknown>) && typeof (existingReturn as { toJSON?: () => Record<string, unknown> }).toJSON === "function"
        ? (existingReturn as { toJSON: () => Record<string, unknown> }).toJSON()
        : (existingReturn as Record<string, unknown>);

      if (Number(plainReturn.status ?? 0) === RETURN_TO_VENDOR_STATUS.FORFEIT && user.userType !== "1") {
        throw new UnauthorizedError("Only admins can modify forfeited vendor returns");
      }
    }

    // Return endpoints are addressed by order id; workflow storage is optional
    // metadata and is created on first edit when missing.
    const returnRecord = await this.shipmentRepository.updateReturnRecord(returnId, SHIPMENT_RETURN_TYPE.TO_VENDOR, payload, user.id);
    if (!returnRecord) {
      throw new NotFoundError("Return not found");
    }

    return success(returnRecord);
  }

  public async updateCustomerReturn(
    returnId: number,
    payload: Partial<ReturnMutationInput>,
    user: ShipmentRequestUser,
  ): Promise<Result<ReturnListResponse["items"][number]>> {
    const returnRecord = await this.shipmentRepository.updateReturnRecord(returnId, SHIPMENT_RETURN_TYPE.FROM_CUSTOMER, payload, user.id);
    if (!returnRecord) {
      throw new NotFoundError("Return not found");
    }

    return success(returnRecord);
  }

  public async updateDeliveryAccount(
    orderId: number,
    payload: { accountingDate?: string | null; accountingReference?: string; accountingStatus?: number },
  ): Promise<Result<{ message: string }>> {
    const updated = await this.shipmentRepository.updateDeliveryAccount(orderId, payload);
    if (!updated) {
      throw new NotFoundError("Delivery account not found");
    }

    return success({ message: "Delivery account updated successfully" });
  }

  public async bulkUpdateDeliveryAccounts(
    orderIds: number[],
    payload: { accountingDate?: string | null; accountingReference?: string; accountingStatus?: number },
  ): Promise<Result<{ message: string; skippedIds: number[]; updatedCount: number }>> {
    const { skippedIds, updatedCount } = await this.shipmentRepository.bulkUpdateDeliveryAccounts(orderIds, payload);
    return success({ message: "Delivery accounts updated successfully", skippedIds, updatedCount });
  }

  public async listInventory(filters: InventoryListQuery, vendorId?: number | null): Promise<Result<InventoryListResponse>> {
    return success(await this.shipmentRepository.listInventory(filters, vendorId));
  }

  public async exportInventory(
    response: Response,
    filters: Omit<InventoryListQuery, "page" | "size">,
    vendorId?: number | null,
  ): Promise<void> {
    const report = await this.shipmentRepository.listInventory({ ...filters, page: 1, size: 1_000_000 }, vendorId);
    await this.writeAccountsWorkbook(response, "inventory.xlsx", "inventory", [
      { header: "كود المنتج", key: "productCode", width: 20 },
      { header: "اسم المنتج", key: "productName", width: 36 },
      { header: "البائع", key: "vendorName", width: 24 },
      { header: "المقاس", key: "size", width: 18 },
      { header: "اللون", key: "color", width: 18 },
      { header: "الكمية", key: "quantity", width: 14 },
      { header: "سعر التكلفة", key: "costPrice", width: 18 },
      { header: "الحالة", key: "statusLabel", width: 18 },
    ], report.items);
  }

  public async createInventoryItem(payload: InventoryMutationInput): Promise<Result<InventoryListResponse["items"][number]>> {
    return success(await this.shipmentRepository.createInventoryItem(payload));
  }

  public async updateInventoryItem(
    inventoryItemId: number,
    payload: Partial<InventoryMutationInput>,
  ): Promise<Result<InventoryListResponse["items"][number]>> {
    const inventoryItem = await this.shipmentRepository.updateInventoryItem(inventoryItemId, payload);
    if (!inventoryItem) {
      throw new NotFoundError("Inventory item not found");
    }

    return success(inventoryItem);
  }

  public async deleteInventoryItem(inventoryItemId: number): Promise<Result<{ message: string }>> {
    const deleted = await this.shipmentRepository.deleteInventoryItem(inventoryItemId);
    if (!deleted) {
      throw new NotFoundError("Inventory item not found");
    }

    return success({ message: "Inventory item deleted successfully" });
  }

  public async listDeliveryAccounts(
    filters: DeliveryAccountsListQuery,
    vendorId?: number | null,
  ): Promise<Result<DeliveryAccountsListResponse>> {
    return success(await this.shipmentRepository.listDeliveryAccounts(filters, vendorId));
  }

  public async listExpenseAccounts(filters: ExpenseAccountsListQuery): Promise<Result<ExpenseAccountsListResponse>> {
    return success(await this.shipmentRepository.listExpenseAccounts(filters));
  }

  public async exportDeliveryAccounts(
    response: Response,
    filters: Omit<DeliveryAccountsListQuery, "page" | "size">,
    vendorId?: number | null,
  ): Promise<void> {
    const report = await this.shipmentRepository.listDeliveryAccounts(
      { ...filters, page: 1, size: 1_000_000 },
      vendorId,
    );
    const exportRows = report.items.map((item) => ({
      ...item,
      accountingDate: item.accountingDate?.slice(0, 10) ?? "",
      deliveryDate: item.deliveryDate?.slice(0, 10) ?? "",
    }));
    await this.writeAccountsWorkbook(response, "delivery-accounts.xlsx", "deliveries", [
      { header: "رقم العملية", key: "operationNumber", width: 18 },
      { header: "رقم الطلب", key: "orderNumber", width: 18 },
      { header: "البائع", key: "sellerName", width: 24 },
      { header: "كود المنتج", key: "productCode", width: 18 },
      { header: "شركة الشحن", key: "shippingCompanyName", width: 22 },
      { header: "تاريخ التسليم الفعلي", key: "deliveryDate", width: 22 },
      { header: "طريقة الدفع", key: "paymentMethodLabel", width: 20 },
      { header: "المبلغ المطلوب تحصيله", key: "amountToCollect", width: 18 },
      { header: "المبلغ المستلم", key: "receivedAmount", width: 16 },
      { header: "حالة المحاسبة", key: "accountingStatusLabel", width: 20 },
      { header: "تاريخ المحاسبة", key: "accountingDate", width: 22 },
      { header: "المرجع", key: "reference", width: 22 },
    ], exportRows);
  }

  public async exportExpenseAccounts(
    response: Response,
    filters: Omit<ExpenseAccountsListQuery, "page" | "size">,
  ): Promise<void> {
    const report = await this.shipmentRepository.listExpenseAccounts({ ...filters, page: 1, size: 1_000_000 });
    await this.writeAccountsWorkbook(response, "expenses.xlsx", "expenses", [
      { header: "التاريخ", key: "accountingDate", width: 22 },
      { header: "النوع", key: "typeLabel", width: 22 },
      { header: "السبب", key: "reason", width: 40 },
      { header: "المبلغ", key: "amount", width: 16 },
      { header: "حالة المحاسبة", key: "accountingStatusLabel", width: 20 },
    ], report.items);
  }

  public async createExpenseAccount(payload: ExpenseMutationInput): Promise<Result<ExpenseAccountsListResponse["items"][number]>> {
    if (!(await this.shipmentRepository.hasExpenseType(payload.type))) {
      throw new NotFoundError("Expense type not found");
    }
    return success(await this.shipmentRepository.createExpenseAccount(payload));
  }

  public async updateExpenseTypes(options: Array<{ id?: number; label: string }>): Promise<Result<Array<{ id: number; label: string }>>> {
    return success(await this.shipmentRepository.updateExpenseTypes(options));
  }

  public async listShippingCompanies(search?: string): Promise<Result<ShippingCompanyListResponse>> {
    return success(await this.shipmentRepository.listShippingCompanies(search));
  }

  public async createShippingCompany(payload: ShippingCompanyMutationInput): Promise<Result<ShippingCompanyItem>> {
    return success(await this.shipmentRepository.createShippingCompany(payload));
  }

  public async updateShippingCompany(
    shippingCompanyId: number,
    payload: ShippingCompanyMutationInput,
  ): Promise<Result<ShippingCompanyItem>> {
    const company = await this.shipmentRepository.updateShippingCompany(shippingCompanyId, payload);
    if (!company) {
      throw new NotFoundError("Shipping company not found");
    }

    return success(company);
  }

  public async deleteShippingCompany(
    shippingCompanyId: number,
  ): Promise<Result<{ linkedOrdersCount: number; message: string }>> {
    const deletion = await this.shipmentRepository.deleteShippingCompany(shippingCompanyId);
    if (!deletion) {
      throw new NotFoundError("Shipping company not found");
    }

    return success({
      linkedOrdersCount: deletion.linkedOrdersCount,
      message: "Shipping company deleted successfully",
    });
  }

  public async updateExpenseAccount(
    expenseId: number,
    payload: Partial<ExpenseMutationInput>,
  ): Promise<Result<ExpenseAccountsListResponse["items"][number]>> {
    if (payload.type !== undefined && !(await this.shipmentRepository.hasExpenseType(payload.type))) {
      throw new NotFoundError("Expense type not found");
    }
    const expense = await this.shipmentRepository.updateExpenseAccount(expenseId, payload);
    if (!expense) {
      throw new NotFoundError("Expense not found");
    }

    return success(expense);
  }

  public async bulkUpdateExpenseAccounts(
    expenseIds: number[],
    payload: Partial<ExpenseMutationInput>,
  ): Promise<Result<{ message: string; skippedIds: number[]; updatedCount: number }>> {
    if (payload.type !== undefined && !(await this.shipmentRepository.hasExpenseType(payload.type))) {
      throw new NotFoundError("Expense type not found");
    }
    const { skippedIds, updatedCount } = await this.shipmentRepository.bulkUpdateExpenseAccounts(expenseIds, payload);
    return success({ message: "Expenses updated successfully", skippedIds, updatedCount });
  }

  public async deleteExpenseAccount(expenseId: number): Promise<Result<{ message: string }>> {
    const deleted = await this.shipmentRepository.deleteExpenseAccount(expenseId);
    if (!deleted) {
      throw new NotFoundError("Expense not found");
    }

    return success({ message: "Expense deleted successfully" });
  }

  public async getPerformance(filters: PerformanceQuery, vendorId?: number | null): Promise<Result<PerformanceResponse>> {
    return success(await this.shipmentRepository.getPerformance(filters, vendorId));
  }

  public async exportPerformance(
    response: Response,
    filters: PerformanceQuery,
    vendorId?: number | null,
  ): Promise<void> {
    const report = await this.shipmentRepository.getPerformance(filters, vendorId);
    const totalReturns = report.providers.reduce((sum, row) => sum + row.returnsCount, 0);
    const rows = [
      {
        deliveredOrdersCount: report.overview.deliveredOrdersCount,
        deliveryByLabel: "الإجمالي",
        returnsCount: totalReturns,
        shippingCompanyName: "",
        totalGmv: report.overview.totalGmv,
      },
      ...report.providers,
    ];
    await this.writeAccountsWorkbook(response, "shipment-performance.xlsx", "performance", [
      { header: "التوصيل بواسطة", key: "deliveryByLabel", width: 22 },
      { header: "شركة الشحن", key: "shippingCompanyName", width: 24 },
      { header: "الطلبات المسلمة", key: "deliveredOrdersCount", width: 18 },
      { header: "المرتجعات", key: "returnsCount", width: 16 },
      { header: "إجمالي GMV", key: "totalGmv", width: 18 },
    ], rows);
  }

  public async exportShipments(response: Response, payload: Record<string, unknown>): Promise<void> {
    await shipmentLegacyGateway.exportShipments(response, payload);
  }

  private async writeAccountsWorkbook(
    response: Response,
    filename: string,
    sheetName: string,
    columns: Array<{ header: string; key: string; width: number }>,
    rows: unknown[],
  ): Promise<void> {
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response });
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = columns;
    rows.forEach((row) => worksheet.addRow(row));
    worksheet.commit();
    await workbook.commit();
    response.end();
  }

  public async updateShipment(shipmentId: number, payload: ShipmentMutationPayload, user: ShipmentRequestUser): Promise<Result<unknown>> {
    const existingShipment = typeof this.shipmentRepository.findShipmentEntity === "function"
      ? await this.shipmentRepository.findShipmentEntity(shipmentId)
      : null;
    const shipment = await this.shipmentRepository.updateShipment(shipmentId, payload, user.id);
    if (!shipment) {
      throw new NotFoundError("Shipment not found");
    }

    await this.refreshAggregateForShipments([existingShipment, shipment, payload]);
    return success(shipment);
  }

  public async bulkUpdateShipments(
    shipmentIds: number[],
    payload: ShipmentMutationPayload,
    user: ShipmentRequestUser,
  ): Promise<Result<{ message: string; updatedCount: number }>> {
    const existingShipments = typeof this.shipmentRepository.findShipmentEntity === "function"
      ? await Promise.all(shipmentIds.map((shipmentId) => this.shipmentRepository.findShipmentEntity(shipmentId)))
      : [];
    const updatedCount = await this.shipmentRepository.bulkUpdateShipments(shipmentIds, payload, user.id);
    await this.refreshAggregateForShipments([...existingShipments, payload]);
    return success({ message: "Shipments updated successfully", updatedCount });
  }

  public async deleteShipment(shipmentId: number): Promise<Result<{ message: string }>> {
    const existingShipment = typeof this.shipmentRepository.findShipmentEntity === "function"
      ? await this.shipmentRepository.findShipmentEntity(shipmentId)
      : null;
    const deleted = await this.shipmentRepository.deleteShipment(shipmentId);
    if (!deleted) {
      throw new NotFoundError("Shipment not found");
    }

    await this.refreshAggregateForShipments([existingShipment]);
    return success({ message: "Shipment deleted successfully" });
  }

  public async addNote(shipmentId: number, text: string, user: ShipmentRequestUser): Promise<Result<unknown>> {
    const shipment = await this.shipmentRepository.findShipmentEntity(shipmentId);
    if (!shipment) {
      throw new NotFoundError("Shipment not found");
    }

    return success(await this.shipmentRepository.createShipmentNote(shipmentId, text, user.id));
  }

  public async updateNote(shipmentId: number, noteId: number, text: string, user: ShipmentRequestUser): Promise<Result<unknown>> {
    const shipment = await this.shipmentRepository.findShipmentEntity(shipmentId);
    if (!shipment) {
      throw new NotFoundError("Shipment not found");
    }

    const note = await this.shipmentRepository.findNoteById(noteId);
    if (!note) {
      throw new NotFoundError("Note not found");
    }

    const plainNote = "toJSON" in (note as Record<string, unknown>) && typeof (note as { toJSON?: () => Record<string, unknown> }).toJSON === "function"
      ? (note as { toJSON: () => Record<string, unknown> }).toJSON()
      : (note as Record<string, unknown>);

    if (Number(plainNote.entityId ?? 0) !== shipmentId || plainNote.entityType !== "shipment") {
      throw new NotFoundError("Note not found");
    }

    if (
      user.userType === "2" ||
      Number(plainNote.userId ?? 0) !== user.id
    ) {
      throw new UnauthorizedError("You are not authorized to update this note");
    }

    const updatedNote = await this.shipmentRepository.updateShipmentNote(noteId, text);
    if (!updatedNote) {
      throw new NotFoundError("Note not found");
    }

    return success(updatedNote);
  }

  public async deleteNote(shipmentId: number, noteId: number, user: ShipmentRequestUser): Promise<Result<{ message: string }>> {
    const shipment = await this.shipmentRepository.findShipmentEntity(shipmentId);
    if (!shipment) {
      throw new NotFoundError("Shipment not found");
    }

    const note = await this.shipmentRepository.findNoteById(noteId);
    if (!note) {
      throw new NotFoundError("Note not found");
    }

    const plainNote = "toJSON" in (note as Record<string, unknown>) && typeof (note as { toJSON?: () => Record<string, unknown> }).toJSON === "function"
      ? (note as { toJSON: () => Record<string, unknown> }).toJSON()
      : (note as Record<string, unknown>);

    if (Number(plainNote.entityId ?? 0) !== shipmentId || plainNote.entityType !== "shipment") {
      throw new NotFoundError("Note not found");
    }

    if (
      user.userType === "2" ||
      Number(plainNote.userId ?? 0) !== user.id
    ) {
      throw new UnauthorizedError("You are not authorized to delete this note");
    }

    const deleted = await this.shipmentRepository.deleteShipmentNote(noteId);
    if (!deleted) {
      throw new NotFoundError("Note not found");
    }

    return success({ message: "Note deleted successfully" });
  }

  private async refreshAggregateForShipments(values: unknown[]): Promise<void> {
    const dates = values.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const plain = "toJSON" in value && typeof (value as { toJSON?: unknown }).toJSON === "function"
        ? (value as { toJSON: () => Record<string, unknown> }).toJSON()
        : value as Record<string, unknown>;
      const rawDate = plain.orderDate;
      if (!rawDate) return [];
      const date = new Date(String(rawDate));
      return Number.isNaN(date.getTime()) ? [] : [date.toISOString().slice(0, 10)];
    });

    const uniqueDates = [...new Set(dates)].sort();
    if (uniqueDates.length > 0) {
      await this.dashboardAggregateService.refreshRange(
        uniqueDates[0]!,
        uniqueDates[uniqueDates.length - 1]!,
      );
    }
  }
}
