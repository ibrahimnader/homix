import { Op } from "sequelize";
import { buildOrderNumberCondition, normalizeOrderNumberSearch } from "./order-number-filter";

describe("order number exact search", () => {
  it("treats 1373, #1373, spaces and case as the same search", () => {
    expect(normalizeOrderNumberSearch("1373")).toBe("1373");
    expect(normalizeOrderNumberSearch("#1373")).toBe("1373");
    expect(normalizeOrderNumberSearch("  # 1373 ")).toBe("1373");
    expect(normalizeOrderNumberSearch("h1373")).toBe("h1373");
    expect(normalizeOrderNumberSearch("H1373")).toBe("h1373");
  });

  it("builds an equality condition on all stored order-number columns, never LIKE", () => {
    const condition = buildOrderNumberCondition("#1373") as Record<symbol, Array<{ logic: unknown }>>;
    const clauses = condition[Op.or] ?? [];
    expect(clauses).toHaveLength(3);
    for (const clause of clauses) {
      expect(clause.logic).toEqual({ [Op.eq]: "1373" });
    }
  });

  it("gives identical conditions for '#1373' and '1373'", () => {
    const a = buildOrderNumberCondition("#1373") as Record<symbol, Array<{ logic: unknown }>>;
    const b = buildOrderNumberCondition("1373") as Record<symbol, Array<{ logic: unknown }>>;
    expect((a[Op.or] ?? []).map((c) => c.logic)).toEqual((b[Op.or] ?? []).map((c) => c.logic));
  });

  it("returns no condition for an empty search", () => {
    expect(buildOrderNumberCondition("  ")).toBeNull();
    expect(buildOrderNumberCondition("#")).toBeNull();
    expect(buildOrderNumberCondition(undefined)).toBeNull();
  });
});
