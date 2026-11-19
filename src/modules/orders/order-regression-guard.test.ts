import { USER_TYPES } from "../../../config/constants";
import { AppError } from "../../shared/errors";
import { OrderService } from "./order.service";
import { detectRegressiveChanges, findOrderRegressions } from "./order-regression-guard";

jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({ refreshRange: jest.fn(), backfill: jest.fn() })),
}));

const delivered = { id: 7, orderNumber: "H7", status: 5, shipmentStatus: 4, manufactureStatus: 6, confirmationStatus: 2 };
const inProgress = { id: 8, orderNumber: "H8", status: 2, shipmentStatus: 3, manufactureStatus: 2, confirmationStatus: 2 };

describe("detectRegressiveChanges", () => {
  it("flags manufacture 2 on a delivered order: explicit manufacture + derived order status", () => {
    const changes = detectRegressiveChanges(delivered, { manufactureStatus: 2 });
    expect(changes.map((change) => `${change.field}:${change.from}->${change.to}:${change.origin}`)).toEqual([
      "status:5->2:derived", "manufactureStatus:6->2:explicit",
    ]);
    expect(changes[0]).toMatchObject({ fieldLabel: "حالة الطلب", fromLabel: "تم التسليم", toLabel: "قيد التصنيع" });
  });
  it("flags a cancel of a delivered order and a schedule cancel, but not forward moves", () => {
    expect(detectRegressiveChanges(delivered, { status: 11 }).map((change) => change.field)).toEqual(["status", "shipmentStatus", "manufactureStatus"]);
    expect(detectRegressiveChanges(delivered, { scheduleStatus: 6 }).length).toBeGreaterThan(0);
    expect(detectRegressiveChanges({ ...delivered, status: 8, shipmentStatus: 2, manufactureStatus: 7 }, { status: 5 })).toEqual([]);
    expect(detectRegressiveChanges(delivered, { status: 6 })).toEqual([]);
    expect(detectRegressiveChanges(inProgress, { status: 5 })).toEqual([]);
  });
  it("ignores unchanged values and unrelated edits", () => {
    expect(detectRegressiveChanges(delivered, { status: 5, manufactureStatus: 6, notes: "x" })).toEqual([]);
  });
});

describe("findOrderRegressions", () => {
  const noInvoices = jest.fn().mockResolvedValue(new Map());
  beforeEach(() => noInvoices.mockClear());

  it("reports final-status orders without touching the invoice tables for them", async () => {
    const regressions = await findOrderRegressions([delivered], { manufactureStatus: 2 }, noInvoices);
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({ orderId: 7, reasons: ["delivered"] });
    expect(noInvoices).not.toHaveBeenCalled();
  });
  it("reports an invoiced order that is not final by status", async () => {
    const regressions = await findOrderRegressions([inProgress], { status: 1 }, async () => new Map([[8, ["reviewed", "transferred"]]]));
    expect(regressions).toHaveLength(1);
    expect(regressions[0]!.reasons).toEqual(["invoice_reviewed", "invoice_transferred"]);
  });
  it("reports nothing for an un-invoiced in-progress order, and does not query invoices without a regressive change", async () => {
    expect(await findOrderRegressions([inProgress], { status: 1 }, noInvoices)).toEqual([]);
    expect(noInvoices).toHaveBeenCalledTimes(1);
    noInvoices.mockClear();
    expect(await findOrderRegressions([inProgress], { notes: "x" }, noInvoices)).toEqual([]);
    expect(noInvoices).not.toHaveBeenCalled();
  });
});

describe("OrderService regression confirmation", () => {
  const build = (orders: Array<Record<string, unknown>>, locked = new Map<number, string[]>()) => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue(orders[0]),
      findOrderEntities: jest.fn().mockResolvedValue(orders),
      findInvoiceLockedOrders: jest.fn().mockResolvedValue(locked),
      findVendorOwnedOrderIds: jest.fn().mockImplementation(async (ids: number[]) => ids),
      createOrderLog: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = {
      updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
      bulkUpdate: jest.fn().mockResolvedValue({ message: "ok", status: true }),
    };
    return { service: new OrderService(repository as never, gateway as never), repository, gateway };
  };
  const staff = { id: 3, userType: "1" } as never;
  const vendor = { id: 4, userType: USER_TYPES.VENDOR, vendorId: 1 } as never;
  const caught = async (promise: Promise<unknown>): Promise<AppError> => {
    try { await promise; } catch (error) { return error as AppError; }
    throw new Error("expected a rejection");
  };

  it("single edit: 409 REGRESSION_NEEDS_CONFIRMATION with Arabic message and details, nothing written", async () => {
    const { service, gateway, repository } = build([delivered]);
    const error = await caught(service.updateOrder(7, { manufactureStatus: 2 }, staff));
    expect(error).toMatchObject({ statusCode: 409, code: "REGRESSION_NEEDS_CONFIRMATION" });
    expect(error.message).toContain("H7");
    expect(error.message).toContain("تم التسليم");
    expect(error.message).toContain("confirmRegression");
    expect((error.details as { regressions: Array<{ orderId: number; changes: unknown[] }> }).regressions[0]).toMatchObject({ orderId: 7, reasons: ["delivered"] });
    expect(gateway.updateOrder).not.toHaveBeenCalled();
    expect(repository.createOrderLog).not.toHaveBeenCalled();
  });

  it("single edit with confirmRegression: applies, strips the flag, and writes an audit row with the actor", async () => {
    const { service, gateway, repository } = build([delivered]);
    await service.updateOrder(7, { manufactureStatus: 2, confirmRegression: true }, staff);
    expect(gateway.updateOrder).toHaveBeenCalledTimes(1);
    expect(gateway.updateOrder.mock.calls[0]![1]).not.toHaveProperty("confirmRegression");
    expect(repository.createOrderLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "regression_confirmed", entityId: 7, entityType: "order", userId: 3, field: "regression", from: "status:5,manufactureStatus:6", to: "status:2,manufactureStatus:2",
    }));
  });

  it("an edit that is not a regression never asks for confirmation or audits", async () => {
    const { service, gateway, repository } = build([inProgress]);
    await service.updateOrder(8, { status: 5 }, staff);
    expect(gateway.updateOrder).toHaveBeenCalled();
    expect(repository.createOrderLog).not.toHaveBeenCalled();
  });

  it("single edit: an invoiced order is guarded too", async () => {
    const { service } = build([inProgress], new Map([[8, ["frozen"]]]));
    const error = await caught(service.updateOrder(8, { status: 1 }, staff));
    expect(error).toMatchObject({ statusCode: 409, code: "REGRESSION_NEEDS_CONFIRMATION" });
    expect((error.details as { regressions: Array<{ reasons: string[] }> }).regressions[0]!.reasons).toEqual(["invoice_frozen"]);
  });

  it("vendors are refused with 403 and cannot pass the flag", async () => {
    const { service, gateway } = build([delivered]);
    const error = await caught(service.updateOrder(7, { manufactureStatus: 2, confirmRegression: true }, vendor));
    expect(error).toMatchObject({ statusCode: 403, code: "REGRESSION_FORBIDDEN" });
    expect(gateway.updateOrder).not.toHaveBeenCalled();
  });

  it("bulk edit: 409 listing every regressing order, then applies with the flag (top-level or inside orderData) and audits each", async () => {
    const { service, gateway, repository } = build([delivered, inProgress]);
    const error = await caught(service.bulkUpdate({ orderIds: [7, 8], orderData: { status: 1 } }, staff));
    expect(error).toMatchObject({ statusCode: 409, code: "REGRESSION_NEEDS_CONFIRMATION" });
    expect((error.details as { regressions: unknown[] }).regressions).toHaveLength(1);
    expect(gateway.bulkUpdate).not.toHaveBeenCalled();

    await service.bulkUpdate({ orderIds: [7, 8], orderData: { status: 1 }, confirmRegression: true }, staff);
    expect(gateway.bulkUpdate).toHaveBeenCalledTimes(1);
    expect(gateway.bulkUpdate.mock.calls[0]![0]).not.toHaveProperty("confirmRegression");
    expect(gateway.bulkUpdate.mock.calls[0]![0].orderData).not.toHaveProperty("confirmRegression");
    expect(repository.createOrderLog).toHaveBeenCalledTimes(1);
    expect(repository.createOrderLog).toHaveBeenCalledWith(expect.objectContaining({ action: "regression_confirmed", entityId: 7, userId: 3 }));

    await service.bulkUpdate({ orderIds: [7], orderData: { status: 1, confirmRegression: true } }, staff);
    expect(gateway.bulkUpdate).toHaveBeenCalledTimes(2);
  });

  it("bulk edit by a vendor with a regression stays refused", async () => {
    const { service, gateway } = build([delivered]);
    const error = await caught(service.bulkUpdate({ orderIds: [7], orderData: { manufactureStatus: 2 }, confirmRegression: true }, vendor));
    expect(error).toMatchObject({ statusCode: 403, code: "REGRESSION_FORBIDDEN" });
    expect(gateway.bulkUpdate).not.toHaveBeenCalled();
  });
});

describe("409 response shape", () => {
  it("the error middleware returns code, message, status false and details.regressions", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { errorMiddleware } = require("../../shared/http/error-middleware");
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) };
    const regressions = [{ orderId: 7, orderNumber: "H7", reasons: ["delivered"], reasonLabels: ["الطلب تم تسليمه"], changes: [] }];
    errorMiddleware(new AppError("msg", 409, "REGRESSION_NEEDS_CONFIRMATION", { regressions }), { operationName: "x", requestId: "r" }, response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ code: "REGRESSION_NEEDS_CONFIRMATION", message: "msg", status: false, details: { regressions } });
  });
});
