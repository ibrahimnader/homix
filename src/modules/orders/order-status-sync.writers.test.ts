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
const mockNotifyShipments = jest.fn();
const mockNotifySchedule = jest.fn();
jest.mock("../shipments/shipment.notifications", () => ({
  ...jest.requireActual("../shipments/shipment.notifications"),
  notifyShipmentStatusChanges: (...args: unknown[]) => mockNotifyShipments(...args),
  notifyShipmentScheduleStatusChanges: (...args: unknown[]) => mockNotifySchedule(...args),
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
  mockNotifyShipments.mockReset();
  mockNotifySchedule.mockReset();
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
    // confirming after a confirmation cancel reopens the order and the cancelled shipment
    [{ confirmationStatus: 2 }, { status: 9, shipmentStatus: 13, confirmationStatus: 7 }, { confirmationStatus: 2, status: 3, shipmentStatus: 1 }],
    [{ confirmationStatus: 2 }, { status: 10, shipmentStatus: 14, confirmationStatus: 9, manufactureStatus: 3 }, { confirmationStatus: 2, status: 3, shipmentStatus: 1 }],
    // going back to "no answer" / pending / call back later reopens a cancelled order to pending (1) with a pending shipment
    [{ confirmationStatus: 4 }, { status: 9, shipmentStatus: 13, confirmationStatus: 7 }, { confirmationStatus: 4, status: 1, shipmentStatus: 1 }],
    // ... a confirmed order goes back to pending (undoes the confirmation promotion), shipment untouched
    [{ confirmationStatus: 4 }, { status: 3, shipmentStatus: 1, confirmationStatus: 2 }, { confirmationStatus: 4, status: 1 }],
    [{ confirmationStatus: 1 }, { status: 3, shipmentStatus: 1, confirmationStatus: 2 }, { confirmationStatus: 1, status: 1 }],
    // ... but never regresses an in-progress/delivered order
    [{ confirmationStatus: 1 }, { status: 2, shipmentStatus: 3, confirmationStatus: 2 }, { confirmationStatus: 1 }],
    [{ confirmationStatus: 6 }, { status: 5, shipmentStatus: 4, confirmationStatus: 7 }, { confirmationStatus: 6 }],
    // ... but never a delivered order
    [{ confirmationStatus: 2 }, { status: 5, shipmentStatus: 4, confirmationStatus: 7 }, { confirmationStatus: 2 }],
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

  it("notifies a schedule-status change made through the legacy single edit, once, with the actor", async () => {
    const order = makeOrder(1, { status: 2, shipmentStatus: 3, scheduleStatus: 1 });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { scheduleStatus: 3 }, user);
    expect(mockNotifySchedule).toHaveBeenCalledWith([{ fromScheduleStatus: 1, orderId: 1, toScheduleStatus: 3 }], 9);
    expect(mockNotifyShipments).not.toHaveBeenCalled();
  });

  it("does not send the schedule-status notification when the order status changed in the same edit", async () => {
    const order = makeOrder(1, { status: 1, shipmentStatus: 1, scheduleStatus: 1, confirmationStatus: 1 });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { scheduleStatus: 4, status: 3 }, user);
    expect(mockNotifySchedule).not.toHaveBeenCalled();
  });

  it("legacy bulk edit sends ONE aggregated schedule-status call for the orders that really changed", async () => {
    const a = makeOrder(1, { status: 2, shipmentStatus: 3, scheduleStatus: 1 });
    const b = makeOrder(2, { status: 2, shipmentStatus: 3, scheduleStatus: 3 });
    const c = makeOrder(3, { status: 2, shipmentStatus: 3, scheduleStatus: null });
    mockOrderFindAll.mockResolvedValue([a, b, c]);
    await OrderService.BulkUpdate({ orderIds: [1, 2, 3], orderData: { scheduleStatus: 3 } }, user);
    expect(mockNotifySchedule).toHaveBeenCalledTimes(1);
    expect(mockNotifySchedule).toHaveBeenCalledWith([
      { fromScheduleStatus: 1, orderId: 1, toScheduleStatus: 3 },
      { fromScheduleStatus: null, orderId: 3, toScheduleStatus: 3 },
    ], 9);
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
      "1:confirmationStatus:1->8", "1:manufactureStatus:->14", "1:shipmentStatus:1->19",
      "2:confirmationStatus:2->8", "2:manufactureStatus:->14", "2:shipmentStatus:4->19",
    ]);
  });

  it("bulk confirmation cancel picks 9 or 10 per order by manufacture status; explicit status wins", async () => {
    const early = makeOrder(1, { status: 2, manufactureStatus: 2 });
    const late = makeOrder(2, { status: 2, manufactureStatus: 4 });
    mockOrderFindAll.mockResolvedValue([early, late]);
    await OrderService.BulkUpdate({ orderIds: [1, 2], orderData: { confirmationStatus: 7 } }, user);
    expect(early.update).toHaveBeenCalledWith(expect.objectContaining({ status: 9, shipmentStatus: 13 }));
    expect(late.update).toHaveBeenCalledWith(expect.objectContaining({ status: 10, shipmentStatus: 14 }));

    // bulk confirm reopens cancelled orders and leaves delivered ones alone
    const cancelled = makeOrder(7, { status: 9, shipmentStatus: 13, confirmationStatus: 7 });
    const delivered = makeOrder(8, { status: 5, shipmentStatus: 4, confirmationStatus: 7 });
    mockOrderFindAll.mockResolvedValue([cancelled, delivered]);
    await OrderService.BulkUpdate({ orderIds: [7, 8], orderData: { confirmationStatus: 2 } }, user);
    expect(cancelled.update).toHaveBeenCalledWith(expect.objectContaining({ status: 3, shipmentStatus: 1 }));
    const deliveredWrite = delivered.update.mock.calls[0]![0];
    expect(deliveredWrite.status).toBeUndefined();
    expect(deliveredWrite.shipmentStatus).toBeUndefined();

    // bulk "no answer" reopens cancelled orders only
    const cancelled2 = makeOrder(11, { status: 10, shipmentStatus: 14, confirmationStatus: 7 });
    const inProgress = makeOrder(12, { status: 2, shipmentStatus: 3, confirmationStatus: 2 });
    mockOrderFindAll.mockResolvedValue([cancelled2, inProgress]);
    await OrderService.BulkUpdate({ orderIds: [11, 12], orderData: { confirmationStatus: 3 } }, user);
    expect(cancelled2.update).toHaveBeenCalledWith(expect.objectContaining({ status: 1, shipmentStatus: 1 }));
    expect(inProgress.update.mock.calls[0]![0].status).toBeUndefined();
    expect(inProgress.update.mock.calls[0]![0].shipmentStatus).toBeUndefined();

    // bulk "pending" sends confirmed orders back to pending, leaves in-progress alone
    const confirmed = makeOrder(21, { status: 3, shipmentStatus: 1, confirmationStatus: 2 });
    const inProgress2 = makeOrder(22, { status: 2, shipmentStatus: 3, confirmationStatus: 2 });
    mockOrderFindAll.mockResolvedValue([confirmed, inProgress2]);
    await OrderService.BulkUpdate({ orderIds: [21, 22], orderData: { confirmationStatus: 1 } }, user);
    expect(confirmed.update).toHaveBeenCalledWith(expect.objectContaining({ status: 1 }));
    expect(inProgress2.update.mock.calls[0]![0].status).toBeUndefined();

    const explicit = makeOrder(3, { status: 2, manufactureStatus: 2 });
    mockOrderFindAll.mockResolvedValue([explicit]);
    await OrderService.BulkUpdate({ orderIds: [3], orderData: { confirmationStatus: 7, status: 3 } }, user);
    expect(explicit.update).toHaveBeenCalledWith(expect.objectContaining({ status: 3, shipmentStatus: 13 }));
  });
});

describe("shipment notifications from the legacy order writers (dedupe against the order notification)", () => {
  it("single edit: a shipment-status-only change sends one shipment notification, attributed to the user", async () => {
    const order = makeOrder(1, { status: 2, shipmentStatus: 1, confirmationStatus: 1 });
    mockOrderFindByPk.mockResolvedValue(order);

    await OrderService.updateOrder(1, { shipmentStatus: 3 }, user);

    /* shipment 3 also derives manufacture 3: that derived stage is announced as a manufacture change (never as an order change). */
    expect(OrderService.sendNotification).toHaveBeenCalledTimes(1);
    expect(OrderService.sendNotification).toHaveBeenCalledWith(1, "ON-1", expect.objectContaining({ type: "orderUpdateManufactureStatus", newStatus: 3 }), false, false, true);
    expect(mockNotifyShipments).toHaveBeenCalledTimes(1);
    expect(mockNotifyShipments).toHaveBeenCalledWith([{ fromStatus: 1, orderId: 1, toStatus: 3 }], 9);
  });

  it("single edit: a change that also moves the order status (explicit or derived) only sends the ORDER notification", async () => {
    const order = makeOrder(1, { status: 2, shipmentStatus: 1, confirmationStatus: 1 });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { status: 3 }, user);
    expect(OrderService.sendNotification).toHaveBeenCalledTimes(1);

    const second = makeOrder(2, { status: 2, shipmentStatus: 1, confirmationStatus: 1 });
    mockOrderFindByPk.mockResolvedValue(second);
    await OrderService.updateOrder(2, { status: 5 }, user); // status 5 derives shipmentStatus 4 as well
    expect(mockNotifyShipments).not.toHaveBeenCalled();
  });

  it("single edit: no shipment notification when nothing about the shipment status changed", async () => {
    const order = makeOrder(1, { status: 2, shipmentStatus: 3, confirmationStatus: 1 });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { shipmentStatus: 3, notes: "x" }, user);
    expect(mockNotifyShipments).not.toHaveBeenCalled();
  });

  it("bulk edit: ONE aggregated call with only the orders whose order status did not change", async () => {
    const a = makeOrder(1, { status: 2, shipmentStatus: 1, confirmationStatus: 1 });
    const b = makeOrder(2, { status: 2, shipmentStatus: 1, confirmationStatus: 1 });
    const alreadyThere = makeOrder(3, { status: 2, shipmentStatus: 3, confirmationStatus: 1 });
    mockOrderFindAll.mockResolvedValue([a, b, alreadyThere]);

    await OrderService.BulkUpdate({ orderIds: [1, 2, 3], orderData: { shipmentStatus: 3 } }, user);

    expect(mockNotifyShipments).toHaveBeenCalledTimes(1);
    expect(mockNotifyShipments).toHaveBeenCalledWith([
      { fromStatus: 1, orderId: 1, toStatus: 3 },
      { fromStatus: 1, orderId: 2, toStatus: 3 },
    ], 9);
  });

  it("bulk edit that changes the order status never sends a shipment notification", async () => {
    mockOrderFindAll.mockResolvedValue([makeOrder(1, { status: 1, shipmentStatus: 1, confirmationStatus: 1 })]);
    await OrderService.BulkUpdate({ orderIds: [1], orderData: { status: 15 } }, user);
    expect(mockNotifyShipments).not.toHaveBeenCalled();
  });
});

describe("PoDate («تاريخ التصنيع») stamping from order status 2 OR manufactureStatus 2", () => {
  const writtenOf = (order: { update: jest.Mock }) => order.update.mock.calls[0]![0] as Record<string, unknown>;

  it("single edit: order status -> 2 stamps PoDate and derives manufacture 2", async () => {
    const order = makeOrder(1, { status: 3, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 1, PoDate: null });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { status: 2 }, user);
    expect(writtenOf(order).PoDate).toBeInstanceOf(Date);
    expect(writtenOf(order).manufactureStatus).toBe(2);
  });

  it("single edit: manufactureStatus -> 2 stamps PoDate and derives order status 2", async () => {
    const order = makeOrder(1, { status: 3, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 1, PoDate: null });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { manufactureStatus: 2 }, user);
    expect(writtenOf(order).PoDate).toBeInstanceOf(Date);
    expect(writtenOf(order).status).toBe(ORDER_STATUS.IN_PROGRESS);
  });

  it("single edit: an unrelated edit or a repeated value never re-stamps an order already in manufacturing", async () => {
    const order = makeOrder(1, { status: 2, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 2, PoDate: "2026-01-01" });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { status: 2, manufactureStatus: 2, notes: "x" }, user);
    expect(writtenOf(order).PoDate).toBeUndefined();
  });

  it("single edit: vendor setting stage 2 on an order already at status 2 with a date does not re-stamp", async () => {
    const order = makeOrder(1, { status: 2, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 1, PoDate: "2026-01-01" });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { manufactureStatus: 2 }, user);
    expect(writtenOf(order).PoDate).toBeUndefined();
  });

  it("single edit: the derived manufacture notification is skipped when the order status changed in the same edit", async () => {
    const order = makeOrder(1, { status: 3, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 1, PoDate: null });
    mockOrderFindByPk.mockResolvedValue(order);
    await OrderService.updateOrder(1, { status: 2 }, user);
    expect(OrderService.sendNotification).toHaveBeenCalledTimes(1);
    expect(OrderService.sendNotification).toHaveBeenCalledWith(1, "ON-1", expect.objectContaining({ type: "orderUpdate" }), true);
  });

  it("bulk edit: stamps per order, only the ones that move into manufacturing (either field)", async () => {
    const moving = makeOrder(1, { status: 3, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 1, PoDate: null });
    const already = makeOrder(2, { status: 2, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 2, PoDate: "2026-01-01" });
    const viaOther = makeOrder(3, { status: 3, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 2, PoDate: "2026-01-01" });
    mockOrderFindAll.mockResolvedValue([moving, already, viaOther]);
    await OrderService.BulkUpdate({ orderIds: [1, 2, 3], orderData: { status: 2 } }, user);
    expect(writtenOf(moving).PoDate).toBeInstanceOf(Date);
    expect(writtenOf(already).PoDate).toBeUndefined();
    expect(writtenOf(viaOther).PoDate).toBeUndefined();
  });

  it("bulk edit: manufactureStatus 2 stamps PoDate and derives order status 2 per order", async () => {
    const a = makeOrder(1, { status: 1, shipmentStatus: 1, confirmationStatus: 1, manufactureStatus: 1, PoDate: null });
    const b = makeOrder(2, { status: 5, shipmentStatus: 4, confirmationStatus: 2, manufactureStatus: 1, PoDate: null });
    mockOrderFindAll.mockResolvedValue([a, b]);
    await OrderService.BulkUpdate({ orderIds: [1, 2], orderData: { manufactureStatus: 2 } }, user);
    expect(writtenOf(a)).toMatchObject({ status: 2, manufactureStatus: 2 });
    expect(writtenOf(a).PoDate).toBeInstanceOf(Date);
    // a delivered order is not pulled back to status 2 by the vendor-side stage, but the stage itself still moves into 2 -> stamped
    expect(writtenOf(b).status).toBeUndefined();
    expect(writtenOf(b).PoDate).toBeInstanceOf(Date);
  });
});
