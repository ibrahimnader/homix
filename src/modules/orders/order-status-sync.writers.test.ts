/* Legacy order writers (single + bulk edit) run the shared status sync inside their existing update call. */
const mockOrderFindByPk = jest.fn();
const mockOrderFindAll = jest.fn();
const mockLogBulkCreate = jest.fn();

jest.mock("../../infrastructure/database", () => ({ sequelize: { define: jest.fn(), transaction: jest.fn(), query: jest.fn() } }));
jest.mock("../../../app/modules/order/order.model", () => ({
  findByPk: (...args: unknown[]) => mockOrderFindByPk(...args),
  findAll: (...args: unknown[]) => mockOrderFindAll(...args),
  findOne: (...args: unknown[]) => mockOrderFindByPk(...args),
}));
jest.mock("../shipments/inventory.movements", () => ({ applyOrderLinesToInventory: jest.fn() }));
jest.mock("../../../app/modules/logs/log.model", () => ({ bulkCreate: (...args: unknown[]) => mockLogBulkCreate(...args) }));
for (const path of [
  "orderLines/orderline.model", "product/product.model", "product/product.service", "customer/customer.service",
  "helpers/shopifyHelper", "vendor/vendor.model", "customer/customer.model", "notes/notes.model", "user/user.model",
  "notification/notification.model", "attachments/attachment.model", "product/productType.model",
]) {
  jest.doMock(`../../../app/modules/${path}`, () => ({}));
}

// eslint-disable-next-line import/first
import { ORDER_STATUS } from "../../../config/constants";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OrderService = require("../../../app/modules/order/order.service");

const makeOrder = (id: number, fields: Record<string, unknown>) => {
  const state: Record<string, unknown> = { id, orderNumber: `ON-${id}`, orderLines: [], ...fields };
  return Object.assign(state, {
    toJSON: () => ({ ...state }),
    update: jest.fn(async (patch: Record<string, unknown>) => { Object.assign(state, patch); }),
  });
};
const user = { id: 9, firstName: "A", lastName: "B" };

beforeEach(() => {
  mockOrderFindByPk.mockReset();
  mockOrderFindAll.mockReset();
  mockLogBulkCreate.mockReset();
  jest.spyOn(OrderService, "sendNotification").mockResolvedValue(undefined);
});

describe("OrderService.updateOrder status sync", () => {
  it.each([
    [{ confirmationStatus: 2 }, { status: 1, confirmationStatus: 1 }, { confirmationStatus: 2, status: ORDER_STATUS.CONFIRMED }],
    [{ confirmationStatus: 7 }, { status: 2, manufactureStatus: 1, confirmationStatus: 1 }, { confirmationStatus: 7, status: 9, shipmentStatus: 13 }],
    [{ confirmationStatus: 9 }, { status: 2, manufactureStatus: 3, confirmationStatus: 1 }, { confirmationStatus: 9, status: 10, shipmentStatus: 14 }],
    [{ status: 15 }, { status: 2, shipmentStatus: 3, confirmationStatus: 1 }, { status: 15, shipmentStatus: 19, confirmationStatus: 8 }],
    [{ status: 3 }, { status: 1, confirmationStatus: 6 }, { status: 3, confirmationStatus: 2 }],
    // reopening from a final state propagates (no guard)
    [{ status: 3 }, { status: 4, shipmentStatus: 5, confirmationStatus: 1 }, { status: 3, confirmationStatus: 2 }],
    // explicit shipmentStatus in the payload wins over the derived one
    [{ status: 5, shipmentStatus: 3 }, { status: 2, shipmentStatus: 1 }, { status: 5, shipmentStatus: 3 }],
  ])("payload %j on %j writes %j", async (payload, stored, expected) => {
    const order = makeOrder(1, stored);
    mockOrderFindByPk.mockResolvedValue(order);
    const result = await OrderService.updateOrder(1, { ...payload }, user);
    expect(result.status).toBe(true);
    const written = order.update.mock.calls[0]![0];
    expect(written).toEqual(expect.objectContaining(expected));
    expect(Object.keys(written).filter((key) => ["status", "shipmentStatus", "confirmationStatus"].includes(key)).sort())
      .toEqual(Object.keys(expected).sort());
  });

  it("logs each derived field as an automatic change naming its source field", async () => {
    const order = makeOrder(1, { status: 2, manufactureStatus: 1, confirmationStatus: 1 });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { confirmationStatus: 7 }, user);
    const logs = mockLogBulkCreate.mock.calls[0]![0];
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "confirmationStatus", to: 7 }),
      expect.objectContaining({ action: "update", field: "status", from: "2", to: "9", userId: 9 }),
      expect.objectContaining({ action: "update", field: "shipmentStatus", from: null, to: "13" }),
      expect.objectContaining({ action: "auto_sync", field: "autoSync", from: "confirmationStatus", to: "status:2->9" }),
      expect.objectContaining({ action: "auto_sync", field: "autoSync", from: "confirmationStatus", to: "shipmentStatus:->13" }),
    ]));
  });

  it("does not loop or derive anything for a payload that only repeats the stored statuses", async () => {
    const order = makeOrder(1, { status: 9, shipmentStatus: 13, confirmationStatus: 7 });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { status: 9, shipmentStatus: 13, confirmationStatus: 7 }, user);
    expect(mockLogBulkCreate.mock.calls[0]![0].filter((row: { action: string }) => row.action === "auto_sync")).toEqual([]);
  });
});

describe("OrderService.BulkUpdate status sync", () => {
  it("derives per order from what changes on that order", async () => {
    const pending = makeOrder(1, { status: 1, shipmentStatus: 1, confirmationStatus: 1 });
    const delivered = makeOrder(2, { status: 5, shipmentStatus: 4, confirmationStatus: 2 });
    mockOrderFindAll.mockResolvedValue([pending, delivered]);

    await OrderService.BulkUpdate({ orderIds: [1, 2], orderData: { status: 15 } }, user);

    expect(pending.update).toHaveBeenCalledWith(expect.objectContaining({ status: 15, shipmentStatus: 19, confirmationStatus: 8 }));
    expect(delivered.update).toHaveBeenCalledWith(expect.objectContaining({ status: 15, shipmentStatus: 19, confirmationStatus: 8 }));
    const markers = mockLogBulkCreate.mock.calls[0]![0].filter((row: { action: string }) => row.action === "auto_sync");
    expect(markers.map((row: { entityId: number; to: string }) => `${row.entityId}:${row.to}`).sort()).toEqual([
      "1:confirmationStatus:1->8", "1:shipmentStatus:1->19", "2:confirmationStatus:2->8", "2:shipmentStatus:4->19",
    ]);
  });

  it("bulk confirmation cancel picks 9 or 10 per order by manufacture status; explicit status wins", async () => {
    const early = makeOrder(1, { status: 2, manufactureStatus: 2 });
    const late = makeOrder(2, { status: 2, manufactureStatus: 4 });
    mockOrderFindAll.mockResolvedValue([early, late]);
    await OrderService.BulkUpdate({ orderIds: [1, 2], orderData: { confirmationStatus: 7 } }, user);
    expect(early.update).toHaveBeenCalledWith(expect.objectContaining({ status: 9, shipmentStatus: 13 }));
    expect(late.update).toHaveBeenCalledWith(expect.objectContaining({ status: 10, shipmentStatus: 14 }));

    const explicit = makeOrder(3, { status: 2, manufactureStatus: 2 });
    mockOrderFindAll.mockResolvedValue([explicit]);
    await OrderService.BulkUpdate({ orderIds: [3], orderData: { confirmationStatus: 7, status: 3 } }, user);
    expect(explicit.update).toHaveBeenCalledWith(expect.objectContaining({ status: 3, shipmentStatus: 13 }));
  });
});
