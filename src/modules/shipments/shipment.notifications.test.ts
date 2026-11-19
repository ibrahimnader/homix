const mockPublish = jest.fn();
const mockAudience = jest.fn();
jest.mock("../notification/notification.publisher", () => ({
  ...jest.requireActual("../notification/notification.publisher"),
  publishNotificationsSafely: (...args: unknown[]) => mockPublish(...args),
  resolveShipmentAudience: (...args: unknown[]) => mockAudience(...args),
}));

import {
  buildShipmentStatusText,
  buildShipmentScheduleStatusText,
  notifyShipmentScheduled,
  notifyShipmentScheduleStatusChanges,
  notifyShipmentStatusChanges,
  shouldNotifyShipmentStatusChange,
} from "./shipment.notifications";

const audience = (ordersByUser: Record<number, number[]>, numbers: Record<number, string> = { 1: "12273", 2: "12274", 3: "12275" }) => ({
  orderNumbers: new Map(Object.entries(numbers).map(([id, n]) => [Number(id), n])),
  ordersByUser: new Map(Object.entries(ordersByUser).map(([id, orders]) => [Number(id), orders])),
  vendorUserIds: new Set<number>(),
});
const publishedRows = () => mockPublish.mock.calls[0]![0] as Array<{ entityId: number; entityType: string; text: string; userId: number }>;

describe("notifyShipmentStatusChanges", () => {
  it("sends one shipment notification with the shipment number and the new status label", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1], 6: [1] }));

    await notifyShipmentStatusChanges([{ fromStatus: 3, orderId: 1, toStatus: 4 }], 99);

    expect(publishedRows()).toEqual([
      { entityId: 1, entityType: "shipment", text: "تم تغيير حالة الشحنة #SH12273 إلى تم التسليم", userId: 5 },
      { entityId: 1, entityType: "shipment", text: "تم تغيير حالة الشحنة #SH12273 إلى تم التسليم", userId: 6 },
    ]);
  });

  it("never notifies the user who made the change", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1], 99: [1] }));

    await notifyShipmentStatusChanges([{ orderId: 1, toStatus: 4 }], 99);

    expect(publishedRows().map((row) => row.userId)).toEqual([5]);
  });

  it("aggregates a bulk change into ONE notification per recipient and scopes it to the orders each one may see", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1, 2, 3], 7: [2] }));

    await notifyShipmentStatusChanges([
      { fromStatus: 1, orderId: 1, toStatus: 4 },
      { fromStatus: 1, orderId: 2, toStatus: 4 },
      { fromStatus: 1, orderId: 3, toStatus: 4 },
    ], 99);

    const rows = publishedRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.userId === 5)).toMatchObject({ entityId: 1, text: "تم تغيير حالة 3 شحنة إلى تم التسليم" });
    /* the vendor only owns one of the shipments -> plain single-shipment text, never the other two */
    expect(rows.find((row) => row.userId === 7)).toMatchObject({ entityId: 2, text: "تم تغيير حالة الشحنة #SH12274 إلى تم التسليم" });
  });

  it("drops rows whose status did not really change and ignores invalid input", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1, 2] }));

    await notifyShipmentStatusChanges([
      { fromStatus: 4, orderId: 1, toStatus: 4 },
      { orderId: 2, toStatus: 4 },
      { orderId: 0, toStatus: 4 },
      { orderId: 3, toStatus: 0 },
    ], 99);

    expect(mockAudience).toHaveBeenCalledWith([2]);
    expect(publishedRows()).toHaveLength(1);
  });

  it("publishes nothing when no change is left", async () => {
    await notifyShipmentStatusChanges([{ fromStatus: 4, orderId: 1, toStatus: 4 }], 99);
    expect(mockAudience).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("uses a generic aggregated text when the targets differ", () => {
    expect(buildShipmentStatusText(
      [{ orderId: 1, toStatus: 4 }, { orderId: 2, toStatus: 5 }],
      new Map(),
    )).toBe("تم تغيير حالة 2 شحنة");
  });

  it("falls back to the id when the order has no number", () => {
    expect(buildShipmentStatusText([{ orderId: 42, toStatus: 2 }], new Map([[42, ""]])))
      .toBe("تم تغيير حالة الشحنة #42 إلى في المخزن");
  });

  it("never throws when resolving the audience fails", async () => {
    mockAudience.mockRejectedValue(new Error("db down"));
    await expect(notifyShipmentStatusChanges([{ orderId: 1, toStatus: 4 }], 99)).resolves.toBeUndefined();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("notifyShipmentScheduled", () => {
  it("notifies the audience except the actor with the new date", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1], 99: [1] }));

    await notifyShipmentScheduled(1, "2026-12-01T10:00:00.000Z", 99);

    expect(publishedRows()).toEqual([
      { entityId: 1, entityType: "shipment", text: "تم جدولة الشحنة #SH12273 بتاريخ 2026-12-01", userId: 5 },
    ]);
  });

  it("ignores an invalid date", async () => {
    await notifyShipmentScheduled(1, "not-a-date", 99);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("notifyShipmentScheduleStatusChanges", () => {
  it("notifies the audience except the actor with the Arabic schedule-status label", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1], 6: [1], 99: [1] }));

    await notifyShipmentScheduleStatusChanges([{ fromScheduleStatus: 1, orderId: 1, toScheduleStatus: 3 }], 99);

    const text = publishedRows()[0]!.text;
    expect(text).toMatch(/^تم تغيير حالة جدولة الشحنة #SH12273 إلى .+/);
    expect(publishedRows()).toEqual([
      { entityId: 1, entityType: "shipment", text, userId: 5 },
      { entityId: 1, entityType: "shipment", text, userId: 6 },
    ]);
  });

  it("uses the 'no answer, first attempt' label for that status", () => {
    const { SHIPMENT_SCHEDULE_STATUS_LABELS } = jest.requireActual("./shipment.constants");
    const id = Object.keys(SHIPMENT_SCHEDULE_STATUS_LABELS).find((key) => SHIPMENT_SCHEDULE_STATUS_LABELS[key].includes("أولى"));
    expect(id).toBeDefined();
    expect(buildShipmentScheduleStatusText([{ orderId: 1, toScheduleStatus: Number(id) }], new Map([[1, "12273"]])))
      .toBe(`تم تغيير حالة جدولة الشحنة #SH12273 إلى ${SHIPMENT_SCHEDULE_STATUS_LABELS[id!]}`);
  });

  it("says the status was cancelled when it is cleared", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1] }));
    await notifyShipmentScheduleStatusChanges([{ fromScheduleStatus: 3, orderId: 1, toScheduleStatus: null }], 99);
    expect(publishedRows()).toEqual([
      { entityId: 1, entityType: "shipment", text: "تم إلغاء حالة جدولة الشحنة #SH12273", userId: 5 },
    ]);
  });

  it("mentions the date when the date changed in the same edit", () => {
    expect(buildShipmentScheduleStatusText(
      [{ orderId: 1, scheduledDeliveryDate: "2026-12-01T10:00:00.000Z", toScheduleStatus: 1 }],
      new Map([[1, "12273"]]),
    )).toMatch(/^تم تغيير حالة جدولة الشحنة #SH12273 إلى .+ بتاريخ 2026-12-01$/);
  });

  it("aggregates a bulk change per recipient, scoped to what each can see", async () => {
    mockAudience.mockResolvedValue(audience({ 5: [1, 2, 3], 7: [2] }));

    await notifyShipmentScheduleStatusChanges([
      { fromScheduleStatus: 1, orderId: 1, toScheduleStatus: 3 },
      { fromScheduleStatus: 1, orderId: 2, toScheduleStatus: 3 },
      { fromScheduleStatus: null, orderId: 3, toScheduleStatus: 3 },
    ], 99);

    const rows = publishedRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.userId === 5)).toMatchObject({ entityId: 1, text: expect.stringMatching(/^تم تغيير حالة جدولة 3 شحنة إلى /) });
    expect(rows.find((row) => row.userId === 7)).toMatchObject({ entityId: 2, text: expect.stringContaining("#SH12274") });
  });

  it("generic text when targets differ, cleared aggregate text when all cleared", () => {
    expect(buildShipmentScheduleStatusText([{ orderId: 1, toScheduleStatus: 3 }, { orderId: 2, toScheduleStatus: 1 }], new Map()))
      .toBe("تم تغيير حالة جدولة 2 شحنة");
    expect(buildShipmentScheduleStatusText([{ orderId: 1, toScheduleStatus: null }, { orderId: 2, toScheduleStatus: null }], new Map()))
      .toBe("تم إلغاء حالة جدولة 2 شحنة");
  });

  it("drops unchanged rows (null/0 equal) and publishes nothing when none is left", async () => {
    await notifyShipmentScheduleStatusChanges([
      { fromScheduleStatus: 3, orderId: 1, toScheduleStatus: 3 },
      { fromScheduleStatus: null, orderId: 2, toScheduleStatus: null },
    ], 99);
    expect(mockAudience).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("never throws when resolving the audience fails", async () => {
    mockAudience.mockRejectedValue(new Error("db down"));
    await expect(notifyShipmentScheduleStatusChanges([{ orderId: 1, toScheduleStatus: 3 }], 99)).resolves.toBeUndefined();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("shouldNotifyShipmentStatusChange (dedupe against the order notification)", () => {
  it("is true for a shipment-status-only change", () => {
    expect(shouldNotifyShipmentStatusChange({ shipmentStatus: 1, status: 2 }, { shipmentStatus: 4, status: 2 })).toBe(true);
  });

  it("is false when the order status changed too: the same-audience ORDER notification covers it", () => {
    expect(shouldNotifyShipmentStatusChange({ shipmentStatus: 1, status: 2 }, { shipmentStatus: 4, status: 6 })).toBe(false);
  });

  it("is false when the shipment status is unchanged or cleared", () => {
    expect(shouldNotifyShipmentStatusChange({ shipmentStatus: 4, status: 2 }, { shipmentStatus: 4, status: 2 })).toBe(false);
    expect(shouldNotifyShipmentStatusChange({ shipmentStatus: 4, status: 2 }, { shipmentStatus: null, status: 2 })).toBe(false);
  });
});
