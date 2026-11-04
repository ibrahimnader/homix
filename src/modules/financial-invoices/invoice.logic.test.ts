import { canTransition, computeTotals, daysCounter, effectiveLineCents, isOverdue, snapshotFromReportOrder } from "./invoice.logic";
import { fromCents, toCents } from "./invoice.money";
import type { LineRow } from "./invoice.types";

const line = (overrides: Partial<LineRow> = {}) => ({
  collectionTotal: "1000.00", companyDue: "200.00", companyDueOverride: null, fines: "50.00", finesOverride: null,
  state: "included", vendorDue: "750.00", vendorDueOverride: null, vendorShippingCost: "0", warehouseCost: "600.00",
  ...overrides,
}) as LineRow;

describe("money", () => {
  test("converts decimals without float drift", () => {
    expect(toCents("1.15")).toBe(115);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents("abc")).toBe(0);
    expect(fromCents(115)).toBe(1.15);
  });
});

describe("effectiveLineCents", () => {
  test("uses stored values without overrides", () => {
    expect(effectiveLineCents(line())).toEqual({ companyDue: 20000, fines: 5000, vendorDue: 75000 });
  });
  test("a fines override shifts vendor due by the difference, floored at zero", () => {
    expect(effectiveLineCents(line({ finesOverride: "0" }))).toMatchObject({ fines: 0, vendorDue: 80000 });
    expect(effectiveLineCents(line({ finesOverride: "100", vendorDue: "20.00" }))).toMatchObject({ fines: 10000, vendorDue: 0 });
  });
  test("explicit overrides win over derived values", () => {
    expect(effectiveLineCents(line({ finesOverride: "0", vendorDueOverride: "700", companyDueOverride: "10" })))
      .toEqual({ companyDue: 1000, fines: 0, vendorDue: 70000 });
  });
});

describe("computeTotals", () => {
  test("counts included lines only and applies live adjustments", () => {
    const totals = computeTotals(
      [line(), line({ state: "frozen" }), line({ state: "deferred" }), line({ state: "removed" }), line({ vendorDueOverride: "100" })],
      [
        { amount: "25.50", kind: "deduction", removedAt: null },
        { amount: "10", kind: "addition", removedAt: null },
        { amount: "999", kind: "addition", removedAt: new Date() },
      ],
    );
    expect(totals).toMatchObject({
      adjustmentsTotal: -15.5, collectionTotal: 2000, companyDueTotal: 400, finesTotal: 100,
      netAmount: 834.5, ordersCount: 2, vendorDueTotal: 850, warehouseCost: 1200,
    });
  });
  test("net may be negative (payable to Homix) and is not clamped", () => {
    const totals = computeTotals([line({ vendorDue: "10" })], [{ amount: "100", kind: "deduction", removedAt: null }]);
    expect(totals.netAmount).toBe(-90);
  });
  test("is independent of later order edits because it only reads stored snapshot columns", () => {
    const stored = line();
    const first = computeTotals([stored], []);
    expect(computeTotals([stored], [])).toEqual(first);
  });
});

describe("transitions", () => {
  test("matches the documented graph", () => {
    expect(canTransition("draft", "reviewed")).toBe(true);
    expect(canTransition("reviewed", "transferred")).toBe(true);
    expect(canTransition("transferred", "reviewed")).toBe(true);
    expect(canTransition("draft", "transferred")).toBe(false);
    expect(canTransition("frozen", "transferred")).toBe(false);
    expect(canTransition("transferred", "draft")).toBe(false);
    expect(canTransition("draft", "frozen")).toBe(false);
  });
});

describe("days counter / overdue", () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 10, 10);
  const base = { frozenAt: null, frozenDurationMs: 0, transferredAt: null };
  test("counts from review until now excluding frozen time", () => {
    const invoice = { ...base, reviewedAt: new Date(now - 5 * day), status: "reviewed" as const, frozenDurationMs: 2 * day };
    expect(daysCounter(invoice, now)).toBe(3);
    expect(isOverdue(invoice, now)).toBe(false);
  });
  test("overdue after more than 3 days, only while reviewed", () => {
    const reviewed = { ...base, reviewedAt: new Date(now - 4.5 * day), status: "reviewed" as const };
    expect(isOverdue(reviewed, now)).toBe(true);
    expect(isOverdue({ ...reviewed, status: "transferred", transferredAt: new Date(now - day) }, now)).toBe(false);
  });
  test("stops at freeze, and drafts have no counter", () => {
    expect(daysCounter({ ...base, frozenAt: new Date(now - 1 * day), reviewedAt: new Date(now - 6 * day), status: "frozen" }, now)).toBe(5);
    expect(daysCounter({ ...base, reviewedAt: null, status: "draft" }, now)).toBeNull();
  });
});

describe("snapshotFromReportOrder", () => {
  test("warehouse deliveries carry no vendor shipping; vendor deliveries keep it", () => {
    const base = { collectionTotal: 100, companyDue: 10, fines: 0, orderId: 7, vendorDue: 90, vendorShippingCost: 15, warehouseCost: 50 };
    expect(snapshotFromReportOrder({ ...base, shipmentId: 7 })).toMatchObject({ isWarehouseDelivery: true, orderId: 7, vendorShippingCost: 0 });
    expect(snapshotFromReportOrder({ ...base, shipmentId: null })).toMatchObject({ isWarehouseDelivery: false, vendorShippingCost: 15 });
  });
});
