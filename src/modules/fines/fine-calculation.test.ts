import { calculateFineForRule, type FineOrder, type FineRule } from "./fine-calculation";

const rule: FineRule = {
  id: 1, trigger: "delivery_delay", amountType: "percent", amount: 1,
  frequency: "daily", basis: "subtotal", graceHours: 24, maxAmount: 250,
  effectiveFrom: "2026-10-01T00:00:00.000Z", active: true,
};
const order: FineOrder = {
  status: 2, orderDate: "2026-10-02T00:00:00.000Z",
  expectedDeliveryDate: "2026-10-10T00:00:00.000Z", deliveryDate: null,
  subTotalPrice: 10000, totalPrice: 12000, commission: 2000, totalCost: 7000,
};

describe("dynamic fine rules", () => {
  it("applies grace hours, daily rate and cap", () => {
    expect(calculateFineForRule(rule, order, new Date("2026-10-14T01:00:00.000Z"))).toBe(250);
  });
  it("does not charge before grace expires or before effective date", () => {
    expect(calculateFineForRule(rule, order, new Date("2026-10-10T23:00:00.000Z"))).toBe(0);
    expect(calculateFineForRule({ ...rule, effectiveFrom: "2026-10-15T00:00:00.000Z" }, order, new Date("2026-10-14T00:00:00.000Z"))).toBe(0);
  });
  it("supports a fixed one-time rule", () => {
    expect(calculateFineForRule({ ...rule, amountType: "fixed", amount: 500, frequency: "once", maxAmount: null }, order, new Date("2026-10-14T00:00:00.000Z"))).toBe(500);
  });
  it("freezes a late warehouse receipt at the actual receiving date", () => {
    const received = { ...order, status: 8, shippingReceiveDate: "2026-10-12T00:00:00.000Z" };
    expect(calculateFineForRule(rule, received, new Date("2026-10-16T00:00:00.000Z"))).toBe(100);
  });
});
