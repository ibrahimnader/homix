const mockCreateMany = jest.fn();
jest.mock("./notification.repo", () => ({
  NotificationRepository: jest.fn().mockImplementation(() => ({ createMany: mockCreateMany })),
}));

const mockUserFindAll = jest.fn();
const mockOrderFindAll = jest.fn();
const mockOrderLineFindAll = jest.fn();
jest.mock("../../../app/modules/user/user.model", () => ({ findAll: (...args: unknown[]) => mockUserFindAll(...args) }));
jest.mock("../../../app/modules/order/order.model", () => ({ findAll: (...args: unknown[]) => mockOrderFindAll(...args) }));
jest.mock("../../../app/modules/orderLines/orderline.model", () => ({ findAll: (...args: unknown[]) => mockOrderLineFindAll(...args) }));
jest.mock("../../../app/modules/product/product.model", () => ({}));

import {
  dropActorAndDuplicates,
  publishNotifications,
  publishNotificationsSafely,
  resolveAdminUserIds,
  resolveOrderAudience,
  resolveOrderVendorUserIds,
  resolveShipmentAudience,
} from "./notification.publisher";

const row = (userId: number, text = "t") => ({ entityId: 5, entityType: "shipment", text, userId });
const globalWithIo = global as { socketIO?: unknown };

afterEach(() => {
  delete globalWithIo.socketIO;
});

describe("dropActorAndDuplicates", () => {
  it("removes the actor, invalid ids and duplicate users (first row wins)", () => {
    const rows = dropActorAndDuplicates(
      [row(1, "a"), row(2, "first"), row(2, "second"), row(0), row(Number.NaN)],
      1,
    );
    expect(rows).toEqual([row(2, "first")]);
  });
});

describe("publishNotifications", () => {
  it("inserts one row per recipient and emits each text to that user's sockets only", async () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    globalWithIo.socketIO = { to };
    mockUserFindAll.mockResolvedValue([
      { id: 2, socketIds: ["s1", "s2"] },
      { id: 3, socketIds: [] },
    ]);

    await publishNotifications([row(2, "for-2"), row(3, "for-3")]);

    expect(mockCreateMany).toHaveBeenCalledWith([row(2, "for-2"), row(3, "for-3")]);
    expect(to.mock.calls.map(([id]) => id)).toEqual(["s1", "s2"]);
    expect(emit).toHaveBeenCalledWith("notification", {
      entityId: 5,
      entityType: "shipment",
      text: "for-2",
      userId: null,
    });
  });

  it("still stores the rows when socket.io is not available", async () => {
    await publishNotifications([row(2)]);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    expect(mockUserFindAll).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list", async () => {
    await publishNotifications([]);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("never throws from the safe wrapper", async () => {
    mockCreateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(publishNotificationsSafely([row(2)], "test")).resolves.toBeUndefined();
  });
});

describe("resolveOrderAudience", () => {
  beforeEach(() => {
    mockOrderFindAll.mockResolvedValue([
      { id: 10, orderNumber: "100" },
      { id: 11, orderNumber: "101" },
    ]);
    mockOrderLineFindAll.mockResolvedValue([
      { orderId: 10, product: { vendorId: 7 } },
      { orderId: 11, product: { vendorId: 8 } },
    ]);
    mockUserFindAll.mockResolvedValue([
      { id: 1, userType: "1", vendorId: null },
      { id: 2, userType: "3", vendorId: null },
      { id: 3, userType: "2", vendorId: 7 },
      { id: 4, userType: "2", vendorId: 9 },
    ]);
  });

  it("gives staff every order and each vendor user only the orders of their vendor", async () => {
    const audience = await resolveOrderAudience([10, 11]);

    expect(audience.ordersByUser.get(1)).toEqual([10, 11]);
    expect(audience.ordersByUser.get(2)).toEqual([10, 11]);
    expect(audience.ordersByUser.get(3)).toEqual([10]);
    expect(audience.ordersByUser.has(4)).toBe(false);
    expect([...audience.vendorUserIds]).toEqual([3]);
    expect(audience.orderNumbers.get(10)).toBe("100");
  });

  it("resolves the vendor users of one order", async () => {
    await expect(resolveOrderVendorUserIds(11)).resolves.toEqual([]);
    await expect(resolveOrderVendorUserIds(10)).resolves.toEqual([3]);
  });

  it("returns an empty audience without querying for no orders", async () => {
    const audience = await resolveOrderAudience([]);
    expect(audience.ordersByUser.size).toBe(0);
    expect(mockOrderFindAll).not.toHaveBeenCalled();
  });
});

describe("resolveShipmentAudience (responsible user + admins + owning vendors)", () => {
  beforeEach(() => {
    mockOrderFindAll.mockResolvedValue([
      { id: 10, orderNumber: "100", userId: 2 },
      { id: 11, orderNumber: "101", userId: null },
      { id: 12, orderNumber: "102", userId: 6 },
    ]);
    mockOrderLineFindAll.mockResolvedValue([
      { orderId: 10, product: { vendorId: 7 } },
      { orderId: 11, product: { vendorId: 8 } },
      { orderId: 12, product: { vendorId: 7 } },
    ]);
    mockUserFindAll.mockResolvedValue([
      { id: 1, userType: "1", vendorId: null }, // admin
      { id: 2, userType: "3", vendorId: null }, // responsible for order 10
      { id: 5, userType: "3", vendorId: null }, // other staff: never notified
      { id: 6, userType: "4", vendorId: null }, // responsible for order 12
      { id: 3, userType: "2", vendorId: 7 }, // vendor of orders 10 and 12
      { id: 4, userType: "2", vendorId: 9 }, // vendor owning nothing
    ]);
  });

  it("notifies admins on every order, the responsible user only on their orders, vendors on their own", async () => {
    const audience = await resolveShipmentAudience([10, 11, 12]);
    expect(audience.ordersByUser.get(1)).toEqual([10, 11, 12]);
    expect(audience.ordersByUser.get(2)).toEqual([10]);
    expect(audience.ordersByUser.get(6)).toEqual([12]);
    expect(audience.ordersByUser.get(3)).toEqual([10, 12]);
    expect(audience.ordersByUser.has(5)).toBe(false);
    expect(audience.ordersByUser.has(4)).toBe(false);
    expect([...audience.vendorUserIds]).toEqual([3]);
  });

  it("an order with no responsible user reaches admins and its vendors only", async () => {
    const audience = await resolveShipmentAudience([11]);
    expect([...audience.ordersByUser.keys()]).toEqual([1]);
  });

  it("a user who is both responsible and admin appears once", async () => {
    mockOrderFindAll.mockResolvedValue([{ id: 10, orderNumber: "100", userId: 1 }]);
    const audience = await resolveShipmentAudience([10]);
    expect([...audience.ordersByUser.keys()].filter((id) => id === 1)).toHaveLength(1);
  });
});

describe("resolveAdminUserIds", () => {
  it("returns admin ids only", async () => {
    mockUserFindAll.mockResolvedValue([{ id: 1 }, { id: 9 }]);
    await expect(resolveAdminUserIds()).resolves.toEqual([1, 9]);
    expect(mockUserFindAll.mock.calls[0][0].where).toEqual({ userType: "1" });
  });
});
