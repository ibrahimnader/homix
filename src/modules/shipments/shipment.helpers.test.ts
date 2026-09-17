import { toDateRangeBoundary } from "./shipment.helpers";

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
