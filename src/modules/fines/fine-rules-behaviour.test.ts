import { calculateFineForRule, type FineOrder, type FineRule } from "./fine-calculation";

const mockQuery = jest.fn();
jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: (...args: unknown[]) => mockQuery(...args), transaction: async (callback: (t: unknown) => unknown) => callback({}) },
}));
// eslint-disable-next-line import/first
import { recalculateRuleFines } from "./recalculate-fines";

const rule = (extra: Partial<FineRule> = {}): FineRule => ({
  id: 1, trigger: "delivery_delay", amountType: "fixed", amount: 100, frequency: "once", basis: "cost", graceHours: 0, maxAmount: null,
  effectiveFrom: "2026-10-01T00:00:00.000Z", active: true, ...extra,
});
const order = (extra: Partial<FineOrder> = {}): FineOrder => ({
  status: 2, orderDate: "2026-10-02T00:00:00.000Z", expectedDeliveryDate: "2026-10-10T00:00:00.000Z", deliveryDate: null, updatedAt: "2026-10-12T00:00:00.000Z",
  subTotalPrice: 1000, totalPrice: 1200, commission: 200, totalCost: 7000, ...extra,
});
const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-12T00:00:00.000Z"); // 2 days after the due date

describe("delivery_delay", () => {
  test("fixed once: charged once regardless of how late", () => {
    expect(calculateFineForRule(rule(), order(), NOW)).toBe(100);
    expect(calculateFineForRule(rule(), order(), at("2026-12-01T00:00:00.000Z"))).toBe(100);
  });
  test("daily counts every started day (ceil)", () => {
    const daily = rule({ frequency: "daily", amount: 50 });
    expect(calculateFineForRule(daily, order(), at("2026-10-10T00:30:00.000Z"))).toBe(50);
    expect(calculateFineForRule(daily, order(), at("2026-10-11T00:00:00.000Z"))).toBe(50);
    expect(calculateFineForRule(daily, order(), at("2026-10-11T00:01:00.000Z"))).toBe(100);
    expect(calculateFineForRule(daily, order(), at("2026-10-13T01:00:00.000Z"))).toBe(200);
  });
  test("grace period delays the start and is not counted as a charged day", () => {
    const daily = rule({ frequency: "daily", amount: 50, graceHours: 48 });
    expect(calculateFineForRule(daily, order(), at("2026-10-12T00:00:00.000Z"))).toBe(0);
    expect(calculateFineForRule(daily, order(), at("2026-10-12T01:00:00.000Z"))).toBe(50);
  });
  test("percent per basis, with 2-decimal rounding", () => {
    const pct = (basis: FineRule["basis"]) => calculateFineForRule(rule({ amountType: "percent", amount: 10, basis }), order(), NOW);
    expect(pct("cost")).toBe(700);
    expect(pct("subtotal")).toBe(100);
    expect(pct("total")).toBe(120);
    expect(pct("commission")).toBe(20);
    expect(calculateFineForRule(rule({ amountType: "percent", amount: 0.33, basis: "total" }), order({ totalPrice: 333.33 }), NOW)).toBe(1.1);
  });
  test("cap limits the whole accumulated amount, null cap means unlimited", () => {
    const capped = rule({ frequency: "daily", amount: 50, maxAmount: 120 });
    expect(calculateFineForRule(capped, order(), at("2026-10-20T00:00:00.000Z"))).toBe(120);
    expect(calculateFineForRule({ ...capped, maxAmount: null }, order(), at("2026-10-20T00:00:00.000Z"))).toBe(500);
  });
  test("on-time delivery or no due date: no fine; effective date, inactive and deleted rules: no fine", () => {
    expect(calculateFineForRule(rule(), order({ status: 5, deliveryDate: "2026-10-09T00:00:00.000Z" }), NOW)).toBe(0);
    expect(calculateFineForRule(rule(), order({ expectedDeliveryDate: null }), NOW)).toBe(0);
    expect(calculateFineForRule(rule({ effectiveFrom: "2026-10-13T00:00:00.000Z" }), order(), NOW)).toBe(0);
    expect(calculateFineForRule(rule({ active: false }), order(), NOW)).toBe(0);
    expect(calculateFineForRule(rule({ deletedAt: "2026-10-11T00:00:00.000Z" }), order(), NOW)).toBe(0);
  });
  test("effective date after the due date only charges from the effective date (daily)", () => {
    const daily = rule({ frequency: "daily", amount: 50, effectiveFrom: "2026-10-11T00:00:00.000Z" });
    expect(calculateFineForRule(daily, order(), at("2026-10-12T00:00:00.000Z"))).toBe(50);
  });
  test("late delivery freezes at the actual delivery date, not now", () => {
    const delivered = order({ status: 5, deliveryDate: "2026-10-13T00:00:00.000Z" });
    const daily = rule({ frequency: "daily", amount: 50 });
    expect(calculateFineForRule(daily, delivered, at("2026-11-30T00:00:00.000Z"))).toBe(150);
  });
  test("returned/replaced/canceled orders (4, 6, 7) and every cancel/reject variant (9-17) are never delay-fined", () => {
    [4, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17].forEach((status) => expect(calculateFineForRule(rule(), order({ status }), NOW)).toBe(0));
  });
  test("in-warehouse (8) uses the shipping receive date", () => {
    expect(calculateFineForRule(rule({ frequency: "daily", amount: 50 }), order({ status: 8, shippingReceiveDate: "2026-10-12T00:00:00.000Z" }), at("2026-12-01T00:00:00.000Z"))).toBe(100);
  });
});

describe("late_cancellation", () => {
  const late = rule({ trigger: "late_cancellation" });
  test("charged only for canceled orders (4 and cancel variants 9-15) canceled after due date + grace", () => {
    [4, 9, 10, 11, 12, 13, 14, 15].forEach((status) => expect(calculateFineForRule(late, order({ status }), NOW)).toBe(100));
    expect(calculateFineForRule(late, order({ status: 4, updatedAt: "2026-10-09T00:00:00.000Z" }), NOW)).toBe(0);
    expect(calculateFineForRule({ ...late, graceHours: 72 }, order({ status: 4 }), NOW)).toBe(0);
  });
  test("reject variants 16/17 and live statuses are not cancellations", () => {
    [16, 17, 1, 2, 3, 5, 6, 7, 8].forEach((status) => expect(calculateFineForRule(late, order({ status }), NOW)).toBe(0));
  });
  test("daily is counted up to the cancel moment, frozen afterwards", () => {
    const daily = { ...late, frequency: "daily" as const, amount: 10 };
    expect(calculateFineForRule(daily, order({ status: 4 }), at("2027-01-01T00:00:00.000Z"))).toBe(20);
  });
});

describe("customer_refusal", () => {
  const refusal = rule({ trigger: "customer_refusal" });
  test("charged for shipment REJECTED (6) and reject-after-mfg variants (20, 21) only", () => {
    [6, 20, 21].forEach((shipmentStatus) => expect(calculateFineForRule(refusal, order({ shipmentStatus }), NOW)).toBe(100));
    [null, undefined, 1, 4, 5, 13, 14, 19].forEach((shipmentStatus) => expect(calculateFineForRule(refusal, order({ shipmentStatus }), NOW)).toBe(0));
  });
  test("refusal before due date + grace is not fined", () => {
    expect(calculateFineForRule({ ...refusal, graceHours: 100 }, order({ shipmentStatus: 6 }), NOW)).toBe(0);
  });
});

describe("manual", () => {
  test("never produced by the calculation (applied explicitly from the page)", () => {
    expect(calculateFineForRule(rule({ trigger: "manual" }), order(), NOW)).toBe(0);
  });
});

describe("recalculateRuleFines", () => {
  beforeEach(() => mockQuery.mockReset());
  test("only loads active, non-deleted, non-manual rules and upserts without touching waived records", async () => {
    mockQuery
      .mockResolvedValueOnce([rule({ id: 7 })])
      .mockResolvedValueOnce([{ id: 11, ...order() }, { id: 12, ...order({ status: 4 }) }])
      .mockResolvedValue([]);
    jest.useFakeTimers().setSystemTime(NOW);
    const changed = await recalculateRuleFines().finally(() => jest.useRealTimers());
    expect(changed).toBe(1); // order 12 is canceled -> not delay-fined
    const ruleSql = String(mockQuery.mock.calls[0][0]);
    expect(ruleSql).toContain("active = TRUE");
    expect(ruleSql).toContain('"deletedAt" IS NULL');
    expect(ruleSql).toContain("trigger <> 'manual'");
    const upsert = String(mockQuery.mock.calls[2][0]);
    expect(upsert).toContain('ON CONFLICT ("ruleId", "orderId") DO UPDATE');
    expect(upsert).toContain('fine_records."waivedAt" IS NULL');
    expect(mockQuery.mock.calls[2][1].replacements).toEqual({ ruleId: 7, orderId: 11, amount: 100 });
    expect(String(mockQuery.mock.calls[3][0])).toContain('"waivedAt" IS NULL'); // orders.fine sums non-waived only
  });
});
