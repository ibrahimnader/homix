const events: string[] = [];
const mockQuery = jest.fn(async (sql: string) => {
  events.push(String(sql).includes("pg_advisory_xact_lock") ? "lock" : "read");
  return [];
});
const mockTransaction = jest.fn(async (callback: (transaction: object) => Promise<void>) => {
  events.push("tx:begin");
  await callback({ id: "tx" });
  events.push("tx:commit");
});
const model = () => ({
  bulkCreate: jest.fn(async () => { events.push("write"); }),
  destroy: jest.fn(async () => { events.push("destroy"); }),
  sync: jest.fn(async () => undefined),
});

jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: mockQuery, transaction: mockTransaction },
}));
jest.mock("./dashboard-daily-metric.model", () => model());
jest.mock("./dashboard-daily-product-sale.model", () => model());
jest.mock("./dashboard-daily-category-sale.model", () => model());
jest.mock("./finance-daily-metric.model", () => model());
jest.mock("../../../app/modules/order/order.model", () => ({}));

import { DashboardAggregateService } from "./dashboard-aggregate.service";

const source = {
  getDeliveredOrdersCountFromOrders: jest.fn(),
  getSnapshotFromOrders: jest.fn(),
};

describe("DashboardAggregateService refresh", () => {
  beforeEach(() => {
    events.length = 0;
    mockQuery.mockClear();
    mockTransaction.mockClear();
  });

  it("computes aggregates before the transaction, which only locks and writes", async () => {
    await new DashboardAggregateService(source).backfill("2026-11-01", "2026-11-03");

    const begin = events.indexOf("tx:begin");
    const commit = events.indexOf("tx:commit");
    expect(begin).toBeGreaterThan(0);
    expect(events.slice(0, begin).every((event) => event === "read")).toBe(true);
    const inside = events.slice(begin + 1, commit);
    expect(inside[0]).toBe("lock");
    expect(inside).not.toContain("read");
    expect(inside.filter((event) => event === "destroy")).toHaveLength(4);
  });

  it("takes one advisory lock per month of the range", async () => {
    await new DashboardAggregateService(source).backfill("2026-10-30", "2026-12-02");
    expect(events.filter((event) => event === "lock")).toHaveLength(3);
  });

  it("ignores an invalid range instead of rebuilding the whole history", async () => {
    await new DashboardAggregateService(source).refreshRange("", "");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
