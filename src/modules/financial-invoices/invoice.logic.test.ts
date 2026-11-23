import { invoiceStatusLabel, netDirectionLabel } from "./invoice.constants";
import { canTransition, computeTotals, daysCounter, dueParty, effectiveLineCents, isOverdue, snapshotFromReportOrder } from "./invoice.logic";
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

describe("effectiveLineCents (reference model)", () => {
  test("uses stored values without overrides (vendor delivery keeps the report's dues; fines are separate)", () => {
    expect(effectiveLineCents(line())).toMatchObject({ companyDue: 20000, fines: 5000, vendorDue: 75000 });
  });
  test("a fines override only changes the fines column, never the dues", () => {
    expect(effectiveLineCents(line({ finesOverride: "0" }))).toMatchObject({ fines: 0, vendorDue: 75000, companyDue: 20000 });
    expect(effectiveLineCents(line({ finesOverride: "100" }))).toMatchObject({ fines: 10000, vendorDue: 75000 });
  });
  test("explicit overrides win over derived values (vendorDue override is the GROSS due)", () => {
    expect(effectiveLineCents(line({ finesOverride: "0", vendorDueOverride: "700", companyDueOverride: "10" })))
      .toMatchObject({ companyDue: 1000, fines: 0, vendorDue: 70000 });
  });
  test("Homix delivery: the snapshot (cost gross, companyDue 0) stands; a cost override re-derives it", () => {
    const homix = line({ companyDueKind: "margin", isWarehouseDelivery: true, collectionTotal: "1500", warehouseCost: "600", fines: "50", vendorDue: "600", companyDue: "0" });
    expect(effectiveLineCents(homix)).toMatchObject({ companyDue: 0, fines: 5000, vendorDue: 60000 });
    expect(effectiveLineCents({ ...homix, warehouseCostOverride: 450 })).toMatchObject({ companyDue: 0, vendorDue: 45000 });
  });
});

describe("computeTotals", () => {
  test("counts included lines only and applies live adjustments (net = vendor - company - fines + adjustments)", () => {
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
      netAmount: 850 - 400 - 100 - 15.5, ordersCount: 2, vendorDueTotal: 850, warehouseCost: 1200,
    });
  });
  test("net may be negative (the vendor owes Homix) and is not clamped", () => {
    const totals = computeTotals([line({ vendorDue: "10", companyDue: "0", fines: "0" })], [{ amount: "100", kind: "deduction", removedAt: null }]);
    expect(totals.netAmount).toBe(-90);
  });
  test("is independent of later order edits because it only reads stored snapshot columns", () => {
    const stored = line();
    const first = computeTotals([stored], []);
    expect(computeTotals([stored], [])).toEqual(first);
  });
});

describe("dueParty / net direction", () => {
  test("derived from the sign of the net: vendor, homix, or null when settled", () => {
    expect(dueParty(10)).toBe("vendor");
    expect(dueParty(-0.01)).toBe("homix");
    expect(dueParty(0)).toBeNull();
  });
  test("transferred labels follow the direction", () => {
    expect(invoiceStatusLabel("transferred", 5)).toBe("تم التحويل للبائع");
    expect(invoiceStatusLabel("transferred", -5)).toBe("تم استلام التحويل من البائع");
    expect(invoiceStatusLabel("transferred", 0)).toBe("تم التحويل");
    expect(invoiceStatusLabel("reviewed", -5)).toBe("تمت المراجعة");
    expect(netDirectionLabel(1)).toBe("صافي المستحق للبائع");
    expect(netDirectionLabel(-1)).toBe("صافي المستحق لهوميكس");
    expect(netDirectionLabel(0)).toBe("لا يوجد مستحق");
  });
});

describe("regression: reference-model scenarios", () => {
  const homixLine = (cost: string, fines = "0", overrides: Partial<LineRow> = {}) => line({
    collectionTotal: String(Number(cost) * 2), companyDue: "0", companyDueKind: "margin", fines, isWarehouseDelivery: true, vendorDue: cost, warehouseCost: cost, ...overrides,
  });
  const vendorLine = (balance: number, fines = "0", overrides: Partial<LineRow> = {}) => line({
    collectionTotal: "1000", companyDue: String(Math.max(balance, 0)), companyDueKind: "vendorOwes", fines, isWarehouseDelivery: false,
    vendorDue: String(Math.max(-balance, 0)), vendorShippingCost: "0", warehouseCost: "600", ...overrides,
  });

  test("all-warehouse with fines: net = sum(cost) - fines (fines are not floored per line)", () => {
    const totals = computeTotals([homixLine("1200", "100"), homixLine("500", "700")], []);
    expect(totals).toMatchObject({ vendorDueTotal: 1700, companyDueTotal: 0, finesTotal: 800, netAmount: 900 });
  });
  test("mixed: Homix deliveries owed to the vendor, vendor deliveries owed to Homix", () => {
    const totals = computeTotals([homixLine("1200", "100"), vendorLine(350, "20")], []);
    expect(totals).toMatchObject({ vendorDueTotal: 1200, companyDueTotal: 350, finesTotal: 120, netAmount: 730 });
  });
  test("vendor delivery owing Homix plus fines gives a negative net", () => {
    const totals = computeTotals([vendorLine(350, "50")], []);
    expect(totals).toMatchObject({ vendorDueTotal: 0, companyDueTotal: 350, finesTotal: 50, netAmount: -400 });
    expect(dueParty(totals.netAmount)).toBe("homix");
  });
  test("vendor delivery where Homix owes the vendor: fines still subtract once", () => {
    const totals = computeTotals([vendorLine(-100, "30")], []);
    expect(totals).toMatchObject({ vendorDueTotal: 100, companyDueTotal: 0, finesTotal: 30, netAmount: 70 });
  });
  test("net exactly 0 is settled (no party)", () => {
    const totals = computeTotals([homixLine("100"), vendorLine(100)], []);
    expect(totals.netAmount).toBe(0);
    expect(dueParty(totals.netAmount)).toBeNull();
  });
  test("overrides feed the same formula (gross vendor due, company due, fines, cost)", () => {
    const totals = computeTotals([
      homixLine("1200", "100", { vendorDueOverride: "1000", finesOverride: "0" }),
      vendorLine(350, "0", { companyDueOverride: "100", finesOverride: "25" }),
      homixLine("500", "0", { warehouseCostOverride: 400 }),
    ], []);
    expect(totals).toMatchObject({ vendorDueTotal: 1400, companyDueTotal: 100, finesTotal: 25, netAmount: 1275 });
  });
  test("manual adjustments move the signed net (and can flip its direction)", () => {
    const base = [homixLine("100")];
    expect(computeTotals(base, [{ amount: "30", kind: "addition", removedAt: null }]).netAmount).toBe(130);
    expect(computeTotals(base, [{ amount: "130", kind: "deduction", removedAt: null }]).netAmount).toBe(-30);
  });
  test("the equation holds for every fixture: vendorDue - companyDue - fines + adjustments = net", () => {
    const fixtures = [[homixLine("1200", "100")], [vendorLine(350, "50")], [homixLine("100"), vendorLine(100)], [vendorLine(-100, "30"), homixLine("77.77", "1.11")]];
    for (const lines of fixtures) {
      const t = computeTotals(lines, [{ amount: "5.05", kind: "addition", removedAt: null }]);
      expect(toCents(t.vendorDueTotal) - toCents(t.companyDueTotal) - toCents(t.finesTotal) + toCents(t.adjustmentsTotal)).toBe(toCents(t.netAmount));
    }
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

describe("effectiveLineCents with cost/collection overrides", () => {
  // Homix delivery: 2,299 collected, 1,200 cost, 100 fines -> vendorDue 1,200 gross, companyDue 0
  const homix = (overrides: Partial<LineRow> = {}) => line({
    collectionTotal: "2299", companyDue: "0", companyDueKind: "margin", fines: "100", isWarehouseDelivery: true, vendorDue: "1200", warehouseCost: "1200", ...overrides,
  });
  const eff = (overrides: Partial<LineRow> = {}) => {
    const e = effectiveLineCents(homix(overrides));
    return { collection: fromCents(e.collection), companyDue: fromCents(e.companyDue), cost: fromCents(e.cost), fines: fromCents(e.fines), vendorDue: fromCents(e.vendorDue) };
  };

  test("no overrides keeps the snapshot", () => {
    expect(eff()).toEqual({ collection: 2299, companyDue: 0, cost: 1200, fines: 100, vendorDue: 1200 });
  });
  test("cost override recalculates the vendor due (cost gross)", () => {
    expect(eff({ warehouseCostOverride: 1000 })).toMatchObject({ cost: 1000, vendorDue: 1000, companyDue: 0 });
  });
  test("collection override moves nothing on a Homix delivery", () => {
    expect(eff({ collectionOverride: 2000 })).toMatchObject({ collection: 2000, vendorDue: 1200, companyDue: 0 });
  });
  test("fines override changes only the fines", () => {
    expect(eff({ finesOverride: 0 })).toMatchObject({ fines: 0, vendorDue: 1200 });
    expect(eff({ finesOverride: 5000 })).toMatchObject({ fines: 5000, vendorDue: 1200 });
  });
  test("due overrides win over everything (and may be 0)", () => {
    expect(eff({ warehouseCostOverride: 1000, finesOverride: 10, vendorDueOverride: 0, companyDueOverride: 5 })).toMatchObject({ vendorDue: 0, companyDue: 5, cost: 1000, fines: 10 });
  });
  test("vendor delivery with a cost/collection override re-settles the balance", () => {
    const vendor = line({ collectionTotal: "1000", companyDue: "200", companyDueKind: "vendorOwes", fines: "0", vendorDue: "0", vendorShippingCost: "0", warehouseCost: "600", warehouseCostOverride: 1100 });
    const resettled = effectiveLineCents(vendor);
    expect([fromCents(resettled.companyDue), fromCents(resettled.vendorDue)]).toEqual([0, 100]);
  });
  test("computeTotals uses the effective cost and collection", () => {
    const totals = computeTotals([homix({ warehouseCostOverride: 1000, collectionOverride: 2000 })], []);
    expect(totals).toMatchObject({ collectionTotal: 2000, warehouseCost: 1000, vendorDueTotal: 1000, companyDueTotal: 0, finesTotal: 100, netAmount: 900 });
  });
});

describe("vendor shipping (شحن البائع) override", () => {
  // vendor delivery: collected 1,000, cost 600, system shipping 50 -> balance 350 for Homix
  const vendorDelivered = (overrides: Partial<LineRow> = {}) => line({
    collectionTotal: "1000", companyDue: "350", companyDueKind: "vendorOwes", fines: "0", vendorDue: "0", vendorShippingCost: "50", warehouseCost: "600", ...overrides,
  });

  test("no override keeps the system shipping and the snapshot dues", () => {
    expect(effectiveLineCents(vendorDelivered())).toMatchObject({ shipping: 5000, companyDue: 35000, vendorDue: 0 });
  });
  test("override replaces the system value and re-settles balance = collection - cost - shipping", () => {
    expect(effectiveLineCents(vendorDelivered({ vendorShippingCostOverride: 120 }))).toMatchObject({ shipping: 12000, companyDue: 28000, vendorDue: 0 });
    // shipping above the margin turns the balance into a (gross) vendor due; fines never reduce it
    expect(effectiveLineCents(vendorDelivered({ vendorShippingCostOverride: 500 }))).toMatchObject({ companyDue: 0, vendorDue: 10000 });
    expect(effectiveLineCents(vendorDelivered({ vendorShippingCostOverride: 500, fines: "30" }))).toMatchObject({ vendorDue: 10000, fines: 3000 });
  });
  test("an override of 0 is a real value, not 'no override'", () => {
    expect(effectiveLineCents(vendorDelivered({ vendorShippingCostOverride: 0 }))).toMatchObject({ shipping: 0, companyDue: 40000 });
  });
  test("explicit due overrides still win over the shipping re-settlement", () => {
    expect(effectiveLineCents(vendorDelivered({ vendorShippingCostOverride: 120, companyDueOverride: 9, vendorDueOverride: 8 }))).toMatchObject({ companyDue: 900, vendorDue: 800, shipping: 12000 });
  });
  test("Homix-delivered lines keep their dues; the shipping override never changes them", () => {
    const homix = line({ collectionTotal: "2299", companyDue: "0", companyDueKind: "margin", fines: "100", vendorDue: "1200", warehouseCost: "1200", vendorShippingCostOverride: 70 });
    expect(effectiveLineCents(homix)).toMatchObject({ companyDue: 0, vendorDue: 120000 });
  });
  test("computeTotals sums the effective shipping of counted lines only", () => {
    const totals = computeTotals([
      vendorDelivered({ vendorShippingCostOverride: 120 }),
      vendorDelivered(),
      vendorDelivered({ vendorShippingCostOverride: 999, state: "frozen" }),
    ], []);
    expect(totals).toMatchObject({ vendorShippingCost: 170, companyDueTotal: 630, ordersCount: 2 });
  });
});

describe("company due kinds", () => {
  test("the snapshot keeps the report's kind (margin / vendorOwes) and defaults to null", () => {
    const base = { collectionTotal: 100, companyDue: 0, fines: 0, orderId: 7, vendorDue: 60, warehouseCost: 60 };
    expect(snapshotFromReportOrder({ ...base, companyDueKind: "margin", shipmentId: 7 })).toMatchObject({ companyDueKind: "margin" });
    expect(snapshotFromReportOrder({ ...base, companyDueKind: "vendorOwes" })).toMatchObject({ companyDueKind: "vendorOwes" });
    expect(snapshotFromReportOrder(base).companyDueKind).toBeNull();
  });

  test("company due enters the net only for vendor-delivered (vendorOwes) lines", () => {
    const vendorLine = (companyDue: string) => line({ companyDue, companyDueKind: "vendorOwes", fines: "0", vendorDue: "100" });
    const adjustments = [{ amount: "10", kind: "deduction" as const, removedAt: null }];
    expect(computeTotals([vendorLine("0")], adjustments).netAmount).toBe(90);
    expect(computeTotals([vendorLine("50")], adjustments).netAmount).toBe(40);
    expect(computeTotals([vendorLine("50")], adjustments).companyDueTotal).toBe(50);
  });

  test("company due totals count vendor-delivered lines only; Homix-delivered overrides are kept but never summed", () => {
    const warehouse = line({ companyDue: "0", companyDueKind: "margin", isWarehouseDelivery: true, collectionTotal: "2299", fines: "100", vendorDue: "1200", warehouseCost: "1200" });
    const vendor = line({ companyDue: "350", companyDueKind: "vendorOwes", isWarehouseDelivery: false, collectionTotal: "1000", fines: "0", vendorDue: "0", vendorShippingCost: "50", warehouseCost: "600" });
    expect(computeTotals([warehouse], []).companyDueTotal).toBe(0);
    expect(computeTotals([warehouse], []).vendorDueTotal).toBe(1200);
    const mixed = computeTotals([warehouse, vendor], []);
    expect(mixed.companyDueTotal).toBe(350);
    expect(mixed.netAmount).toBe(1200 - 350 - 100);
    // a NULL kind falls back to isWarehouseDelivery
    expect(computeTotals([{ ...warehouse, companyDueKind: null }], []).companyDueTotal).toBe(0);
    expect(computeTotals([{ ...warehouse, companyDueOverride: "777" }], []).companyDueTotal).toBe(0);
  });
});
