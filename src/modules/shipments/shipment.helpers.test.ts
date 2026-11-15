import { isExcludedFromGroupedShipment, summarizeGroupedShipment, toDateRangeBoundary } from "./shipment.helpers";

describe("shipment date filter boundaries", () => {
  it.each(["2026-09-17", "2026-09-16T21:00:00.000Z", "2026-09-17T12:30:00+03:00"])(
    "includes all of September 17 in Cairo for %s", (input) => {
      const start = toDateRangeBoundary(input, "start")!;
      const end = toDateRangeBoundary(input, "end")!;
      expect(start.toISOString()).toBe("2026-09-16T21:00:00.000Z");
      expect(end.toISOString()).toBe("2026-09-17T20:59:59.999Z");
      const shipment48889 = new Date("2026-09-16T22:00:00.000Z");
      expect(shipment48889 >= start && shipment48889 <= end).toBe(true);
      expect(new Date("2026-09-17T21:00:00.000Z") > end).toBe(true);
    },
  );

  it("uses the winter UTC offset rather than assuming UTC+3 all year", () => {
    expect(toDateRangeBoundary("2026-01-17", "start")?.toISOString()).toBe("2026-01-16T22:00:00.000Z");
    expect(toDateRangeBoundary("2026-01-17", "end")?.toISOString()).toBe("2026-01-17T21:59:59.999Z");
  });

  it.each(["", "invalid", "2026-02-30", null, undefined])("rejects invalid input %s", (input) => {
    expect(toDateRangeBoundary(input, "start")).toBeNull();
    expect(toDateRangeBoundary(input, "end")).toBeNull();
  });
});

describe("grouped shipment completeness", () => {
  // in warehouse = shipmentStatus 2 (mirrors the repo predicate for these fixtures)
  const reached = (o: Record<string, unknown>) => o.shipmentStatus === 2;
  const ok = { status: 1, shipmentStatus: 2 };
  const missing = { status: 1, shipmentStatus: 1 };

  it("complete when all are in the warehouse", () => {
    expect(summarizeGroupedShipment([ok, ok, ok], reached)).toEqual({ complete: true, inWarehouseCount: 3, relatedCount: 3 });
  });

  it("incomplete when one is missing", () => {
    expect(summarizeGroupedShipment([ok, ok, missing], reached)).toEqual({ complete: false, inWarehouseCount: 2, relatedCount: 3 });
  });

  it("ignores a cancelled sibling when the rest are in the warehouse", () => {
    expect(summarizeGroupedShipment([ok, ok, { status: 4, shipmentStatus: 1 }], reached))
      .toEqual({ complete: true, inWarehouseCount: 2, relatedCount: 2 });
  });

  it("is null when every sibling is excluded", () => {
    expect(summarizeGroupedShipment([{ status: 4, shipmentStatus: 1 }, { status: 1, shipmentStatus: 5 }], reached)).toBeNull();
  });

  it("is null when only one countable item remains", () => {
    expect(summarizeGroupedShipment([ok, { status: 9, shipmentStatus: 1 }], reached)).toBeNull();
  });

  it.each([4, 9, 10, 11, 12, 13, 14, 15, 16, 17])("excludes order status %i", (status) => {
    expect(isExcludedFromGroupedShipment({ status, shipmentStatus: 1 })).toBe(true);
  });

  it.each([5, 6, 13, 14, 15, 16, 17, 18, 19, 20, 21])("excludes shipment status %i", (shipmentStatus) => {
    expect(isExcludedFromGroupedShipment({ status: 1, shipmentStatus })).toBe(true);
  });

  it.each([1, 2, 3, 4, 7, 8, 9, 10, 11, 12])("keeps shipment status %i", (shipmentStatus) => {
    expect(isExcludedFromGroupedShipment({ status: 1, shipmentStatus })).toBe(false);
  });
});
