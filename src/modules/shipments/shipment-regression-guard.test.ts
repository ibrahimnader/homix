import { USER_TYPES } from "../../../config/constants";
import { AppError } from "../../shared/errors";
import { ShipmentService } from "./shipment.service";
import { shipmentBulkUpdateSchema, shipmentMutationSchema, shipmentReturnMutationSchema } from "./shipment.schemas";

jest.mock("./shipment.notifications", () => ({
  ...jest.requireActual("./shipment.notifications"),
  notifyShipmentScheduleStatusChanges: jest.fn(),
  notifyShipmentScheduled: jest.fn(),
  notifyShipmentStatusChanges: jest.fn(),
}));
jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({ refreshRange: jest.fn() })),
}));

/* Delivered order: any move to an earlier state is a regression. In-progress order: only invoiced ones are. */
const delivered = { id: 7, orderNumber: "H7", status: 5, shipmentStatus: 4, manufactureStatus: 6, confirmationStatus: 2, scheduleStatus: null };
const inProgress = { id: 8, orderNumber: "H8", status: 2, shipmentStatus: 3, manufactureStatus: 2, confirmationStatus: 2, scheduleStatus: null };

const staff = { id: 3, userType: USER_TYPES.ADMIN } as never;
const vendor = { id: 4, userType: USER_TYPES.VENDOR } as never;

const build = (rows: Array<Record<string, unknown>>, locked = new Map<number, string[]>()) => {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const repository = {
    findShipmentEntity: jest.fn(async (id: number) => byId.get(id) ?? null),
    findInvoiceLockedOrders: jest.fn().mockResolvedValue(locked),
    createRegressionAuditLogs: jest.fn().mockResolvedValue(undefined),
    updateShipment: jest.fn(async (id: number) => byId.get(id)),
    bulkUpdateShipments: jest.fn().mockResolvedValue(rows.length),
    createReturnRecord: jest.fn().mockResolvedValue({ id: 7 }),
  };
  return { service: new ShipmentService(repository as never), repository };
};
const caught = async (promise: Promise<unknown>): Promise<AppError> => {
  try { await promise; } catch (error) { return error as AppError; }
  throw new Error("expected a rejection");
};
const expectNothingWritten = (repository: ReturnType<typeof build>["repository"]) => {
  expect(repository.updateShipment).not.toHaveBeenCalled();
  expect(repository.bulkUpdateShipments).not.toHaveBeenCalled();
  expect(repository.createReturnRecord).not.toHaveBeenCalled();
  expect(repository.createRegressionAuditLogs).not.toHaveBeenCalled();
};

describe("shipment single edit regression guard", () => {
  it("409 with details when a status edit moves a delivered order backwards, nothing written", async () => {
    const { service, repository } = build([delivered]);
    const error = await caught(service.updateShipment(7, { manufactureStatus: 2 }, staff));
    expect(error).toMatchObject({ statusCode: 409, code: "REGRESSION_NEEDS_CONFIRMATION" });
    expect((error.details as { regressions: Array<{ orderId: number; reasons: string[] }> }).regressions[0])
      .toMatchObject({ orderId: 7, reasons: ["delivered"] });
    expectNothingWritten(repository);
  });
  it("also guards shipmentStatus and scheduleStatus edits", async () => {
    const { service, repository } = build([delivered]);
    expect((await caught(service.updateShipment(7, { shipmentStatus: 3 }, staff))).statusCode).toBe(409);
    expect((await caught(service.updateShipment(7, { scheduleStatus: 6 }, staff))).statusCode).toBe(409);
    expectNothingWritten(repository);
  });
  it("guards an order on a reviewed invoice line even when it is not final by status", async () => {
    const { service, repository } = build([inProgress], new Map([[8, ["reviewed"]]]));
    const error = await caught(service.updateShipment(8, { shipmentStatus: 1 }, staff));
    expect(error.statusCode).toBe(409);
    expect((error.details as { regressions: Array<{ reasons: string[] }> }).regressions[0]!.reasons).toEqual(["invoice_reviewed"]);
    expectNothingWritten(repository);
  });
  it("confirmed: writes with the flag stripped and one regression_confirmed audit row (true and \"true\")", async () => {
    for (const flag of [true, "true"]) {
      const { service, repository } = build([delivered]);
      await service.updateShipment(7, { manufactureStatus: 2, confirmRegression: flag, notes: "x" }, staff);
      expect(repository.updateShipment).toHaveBeenCalledWith(7, { manufactureStatus: 2, notes: "x" }, 3);
      expect(repository.createRegressionAuditLogs).toHaveBeenCalledTimes(1);
      expect(repository.createRegressionAuditLogs.mock.calls[0]![0]).toEqual([
        expect.objectContaining({ action: "regression_confirmed", entityId: 7, entityType: "order", field: "regression", userId: 3 }),
      ]);
    }
  });
  it("a string \"false\" does not confirm", async () => {
    const { service, repository } = build([delivered]);
    expect((await caught(service.updateShipment(7, { manufactureStatus: 2, confirmRegression: "false" }, staff))).statusCode).toBe(409);
    expectNothingWritten(repository);
  });
  it("vendors get 403 REGRESSION_FORBIDDEN even with the flag", async () => {
    const { service, repository } = build([delivered]);
    const error = await caught(service.updateShipment(7, { manufactureStatus: 2, confirmRegression: true }, vendor));
    expect(error).toMatchObject({ statusCode: 403, code: "REGRESSION_FORBIDDEN" });
    expectNothingWritten(repository);
  });
  it("forward moves and unrelated edits are not flagged and write no audit row", async () => {
    const { service, repository } = build([inProgress], new Map([[8, ["reviewed"]]]));
    await service.updateShipment(8, { shipmentStatus: 4 }, staff);
    await service.updateShipment(8, { notes: "x" }, staff);
    expect(repository.updateShipment).toHaveBeenCalledTimes(2);
    expect(repository.createRegressionAuditLogs).not.toHaveBeenCalled();
  });
});

describe("shipment bulk edit regression guard", () => {
  it("one regressive row refuses the whole bulk edit before any row is written", async () => {
    const { service, repository } = build([inProgress, delivered]);
    const error = await caught(service.bulkUpdateShipments([8, 7], { manufactureStatus: 2 }, staff));
    expect(error).toMatchObject({ statusCode: 409, code: "REGRESSION_NEEDS_CONFIRMATION" });
    expect((error.details as { regressions: Array<{ orderId: number }> }).regressions.map((entry) => entry.orderId)).toEqual([7]);
    expectNothingWritten(repository);
  });
  it("confirmed: writes all rows with the flag stripped and one audit row per regressed order", async () => {
    const { service, repository } = build([inProgress, delivered]);
    await service.bulkUpdateShipments([8, 7], { manufactureStatus: 2, confirmRegression: true }, staff);
    expect(repository.bulkUpdateShipments).toHaveBeenCalledWith([8, 7], { manufactureStatus: 2 }, 3);
    expect(repository.createRegressionAuditLogs.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ action: "regression_confirmed", entityId: 7 }),
    ]);
  });
  it("vendors get 403 and nothing is written", async () => {
    const { service, repository } = build([delivered]);
    const error = await caught(service.bulkUpdateShipments([7], { shipmentStatus: 3, confirmRegression: "true" }, vendor));
    expect(error).toMatchObject({ statusCode: 403, code: "REGRESSION_FORBIDDEN" });
    expectNothingWritten(repository);
  });
  it("forward moves are not flagged", async () => {
    const { service, repository } = build([inProgress]);
    await service.bulkUpdateShipments([8], { shipmentStatus: 4 }, staff);
    expect(repository.bulkUpdateShipments).toHaveBeenCalledTimes(1);
    expect(repository.createRegressionAuditLogs).not.toHaveBeenCalled();
  });
});

describe("returns regression guard", () => {
  const payload = { orderId: 7, reason: "تالف" };
  /* replaced shipment (9) on a frozen invoice line: either return moves it to an earlier state */
  const invoiced = () => build([{ ...inProgress, id: 7, shipmentStatus: 9 }], new Map([[7, ["frozen"]]]));
  it("409 for a vendor and a customer return that move an invoiced order backwards, nothing written", async () => {
    for (const create of ["createVendorReturn", "createCustomerReturn"] as const) {
      const { service, repository } = invoiced();
      const error = await caught(service[create](payload as never, staff));
      expect(error).toMatchObject({ statusCode: 409, code: "REGRESSION_NEEDS_CONFIRMATION" });
      expect((error.details as { regressions: Array<{ orderId: number; reasons: string[] }> }).regressions[0])
        .toMatchObject({ orderId: 7, reasons: ["invoice_frozen"] });
      expectNothingWritten(repository);
    }
  });
  it("confirmed: creates the return without the flag and audits it", async () => {
    const { service, repository } = invoiced();
    await service.createVendorReturn({ ...payload, confirmRegression: true } as never, staff);
    expect(repository.createReturnRecord).toHaveBeenCalledWith(expect.any(Number), payload, 3);
    expect(repository.createRegressionAuditLogs.mock.calls[0]![0]).toEqual([expect.objectContaining({ action: "regression_confirmed", entityId: 7 })]);
  });
  it("vendors get 403", async () => {
    const { service, repository } = invoiced();
    expect(await caught(service.createVendorReturn({ ...payload, confirmRegression: true } as never, vendor)))
      .toMatchObject({ statusCode: 403, code: "REGRESSION_FORBIDDEN" });
    expectNothingWritten(repository);
  });
  it("forward returns are not flagged: delivered -> returned from customer, and in-warehouse -> returned to vendor", async () => {
    const { service, repository } = build([delivered]);
    await service.createCustomerReturn(payload as never, staff);
    await service.createVendorReturn(payload as never, staff);
    const warehouse = build([{ ...inProgress, id: 7, status: 8, shipmentStatus: 2 }]);
    await warehouse.service.createVendorReturn(payload as never, staff);
    expect(repository.createReturnRecord).toHaveBeenCalledTimes(2);
    expect(warehouse.repository.createReturnRecord).toHaveBeenCalledTimes(1);
    expect(repository.createRegressionAuditLogs).not.toHaveBeenCalled();
    expect(warehouse.repository.createRegressionAuditLogs).not.toHaveBeenCalled();
  });
});

describe("request schemas accept the confirmRegression flag", () => {
  it("single edit, bulk (top level and nested) and return creation", () => {
    expect(shipmentMutationSchema.safeParse({ confirmRegression: true }).success).toBe(true);
    expect(shipmentMutationSchema.safeParse({ confirmRegression: "true" }).success).toBe(true);
    expect(shipmentMutationSchema.safeParse({ confirmRegression: "yes" }).success).toBe(false);
    expect(shipmentBulkUpdateSchema.safeParse({ shipmentIds: [1], confirmRegression: true, data: { shipmentStatus: 3 } }).success).toBe(true);
    expect(shipmentBulkUpdateSchema.safeParse({ shipmentIds: [1], data: { shipmentStatus: 3, confirmRegression: "true" } }).success).toBe(true);
    expect(shipmentBulkUpdateSchema.safeParse({ shipmentIds: [1], data: { confirmRegression: true } }).success).toBe(false);
    expect(shipmentReturnMutationSchema.safeParse({ orderId: 1, reason: "x", confirmRegression: true }).success).toBe(true);
  });
});
