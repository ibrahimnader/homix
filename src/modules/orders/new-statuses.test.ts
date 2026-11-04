import {
  CANCELED_LIKE_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  CLOSED_SHIPMENT_STATUSES,
  MANUFACTURE_STATUS_ARABIC,
  ORDER_STATUS,
  ORDER_STATUS_Arabic,
  SHIPMENTS_STATUS,
} from "../../../config/constants";
import { FINAL_ORDER_STATUSES, ORDER_SUMMARY_STATUS_GROUPS } from "./order.constants";
import { SHIPMENT_FINAL_STATUSES, SHIPMENT_STATUS, SHIPMENT_STATUS_LABELS } from "../shipments/shipment.constants";
import { calculateFineForRule, type FineOrder, type FineRule } from "../fines/fine-calculation";

describe("legacy ids are frozen (append-only)", () => {
  it("keeps existing order ids", () => {
    expect(ORDER_STATUS).toMatchObject({ PENDING: 1, IN_PROGRESS: 2, CONFIRMED: 3, CANCELED: 4, DELIVERED: 5, REFUNDED: 6, REPLACED: 7, IN_INVENTORY: 8 });
    expect(ORDER_STATUS_Arabic[4]).toBe("ملغي");
  });
  it("keeps existing shipment ids", () => {
    expect(SHIPMENT_STATUS).toMatchObject({ PENDING: 1, DELIVERED: 4, CANCELED: 5, REJECTED: 6, RETURNED_FROM_CUSTOMER: 7, REPLACED: 9, OUT_FOR_DELIVERY: 12 });
    expect(SHIPMENTS_STATUS).toMatchObject({ CANCELED: 5, REJECTED: 6, OUT_FOR_DELIVERY: 12 });
  });
  it("keeps existing manufacture labels", () => {
    expect(MANUFACTURE_STATUS_ARABIC[4]).toBe("تم الشحن");
    expect(MANUFACTURE_STATUS_ARABIC[6]).toBe("تم التوصيل");
  });
});

describe("new statuses", () => {
  it("order ids 9-17 are labelled and closed", () => {
    expect([...CLOSED_ORDER_STATUSES]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    CLOSED_ORDER_STATUSES.forEach((id: number) => {
      expect((ORDER_STATUS_Arabic as Record<number, string>)[id]).toBeTruthy();
      expect(FINAL_ORDER_STATUSES).toContain(id);
      expect(ORDER_SUMMARY_STATUS_GROUPS.canceledOrRefunded).toContain(id);
    });
    expect(CANCELED_LIKE_ORDER_STATUSES).toContain(ORDER_STATUS.CANCELED);
  });
  it("shipment ids 13-21 are labelled and final, labels match the order variants", () => {
    expect([...CLOSED_SHIPMENT_STATUSES]).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21]);
    CLOSED_SHIPMENT_STATUSES.forEach((id: number, i: number) => {
      expect(SHIPMENT_STATUS_LABELS[id]).toBe((ORDER_STATUS_Arabic as Record<number, string>)[CLOSED_ORDER_STATUSES[i] as number]);
      expect(SHIPMENT_FINAL_STATUSES).toContain(id);
    });
    expect(Object.values(SHIPMENT_STATUS)).toEqual(expect.arrayContaining([...CLOSED_SHIPMENT_STATUSES]));
  });
  it("manufacture ids 7-18 are labelled", () => {
    for (let id = 7; id <= 18; id += 1) expect((MANUFACTURE_STATUS_ARABIC as Record<number, string>)[id]).toBeTruthy();
    expect((MANUFACTURE_STATUS_ARABIC as Record<number, string>)[7]).toBe("في المخزن");
  });
});

describe("fines treat new variants like their closest legacy status", () => {
  const base: Omit<FineRule, "trigger"> = {
    id: 1, amountType: "fixed", amount: 100, frequency: "once", basis: "subtotal", graceHours: 0, maxAmount: null,
    effectiveFrom: "2026-01-01T00:00:00.000Z", active: true,
  };
  const order: FineOrder = {
    status: 2, orderDate: "2026-10-01T00:00:00.000Z", expectedDeliveryDate: "2026-10-05T00:00:00.000Z",
    deliveryDate: null, updatedAt: "2026-10-08T00:00:00.000Z", subTotalPrice: 1000, totalPrice: 1000, commission: 0, totalCost: 0,
  };
  const now = new Date("2026-10-10T00:00:00.000Z");
  it("late_cancellation applies to cancel_* variants but not reject_*", () => {
    const rule = { ...base, trigger: "late_cancellation" } as FineRule;
    expect(calculateFineForRule(rule, { ...order, status: ORDER_STATUS.CANCELED }, now)).toBe(100);
    expect(calculateFineForRule(rule, { ...order, status: ORDER_STATUS.CANCELED_AFTER_MFG_DELAY }, now)).toBe(100);
    expect(calculateFineForRule(rule, { ...order, status: ORDER_STATUS.REJECTED_AFTER_MFG_MISMATCH }, now)).toBe(0);
  });
  it("customer_refusal applies to reject_* shipment variants", () => {
    const rule = { ...base, trigger: "customer_refusal" } as FineRule;
    expect(calculateFineForRule(rule, { ...order, shipmentStatus: SHIPMENTS_STATUS.REJECTED }, now)).toBe(100);
    expect(calculateFineForRule(rule, { ...order, shipmentStatus: SHIPMENTS_STATUS.REJECTED_AFTER_MFG_NOT_SUITABLE }, now)).toBe(100);
    expect(calculateFineForRule(rule, { ...order, shipmentStatus: SHIPMENTS_STATUS.CANCELED_AFTER_MFG_DELAY }, now)).toBe(0);
  });
  it("delivery_delay charges nothing for cancelled variants, like CANCELED", () => {
    const rule = { ...base, trigger: "delivery_delay" } as FineRule;
    expect(calculateFineForRule(rule, { ...order, status: ORDER_STATUS.CANCELED }, now)).toBe(0);
    expect(calculateFineForRule(rule, { ...order, status: ORDER_STATUS.CANCELED_AFTER_MFG_FAKE_ORDER }, now)).toBe(0);
  });
});
