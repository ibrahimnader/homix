import express from "express";
import request from "supertest";

const mockQuery = jest.fn();
jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: (...args: unknown[]) => mockQuery(...args), transaction: jest.fn() },
}));
// eslint-disable-next-line import/first
import { reassignmentRouter } from "./reassignment.routes";

const appFor = (permissions: Record<string, boolean>) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 7, userType: "4", permissions } as never;
    next();
  });
  app.use("/reassignments", reassignmentRouter);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.name === "ZodError" ? 400 : 500).json({ status: false }));
  return app;
};
const row = (id: number, code: string, status = 2) => ({
  id, code, orderNumber: `ON-${id}`, status, shipmentStatus: 2, customerName: "عميل",
});
const line = (orderId: number, quantity = 2) => ({ orderId, productId: 17, sku: "A", quantity });

beforeEach(() => mockQuery.mockReset());

test("candidate search requires ship_view and valid input", async () => {
  expect((await request(appFor({})).get("/reassignments/candidates?sourceOrderId=1&q=12")).status).toBe(403);
  const app = appFor({ ship_view: true });
  expect((await request(app).get("/reassignments/candidates?sourceOrderId=1")).status).toBe(400);
  expect((await request(app).get("/reassignments/candidates?sourceOrderId=x&q=12")).status).toBe(400);
});

test("candidate search flags eligibility and sorts eligible first", async () => {
  mockQuery
    .mockResolvedValueOnce([row(5, "1200"), row(6, "1201"), row(7, "1202", 5)])
    .mockResolvedValueOnce([line(1), line(5, 9), line(6), line(7)])
    .mockResolvedValueOnce([]);
  const res = await request(appFor({ ship_view: true })).get("/reassignments/candidates?sourceOrderId=1&q=120");
  expect(res.status).toBe(200);
  expect(res.body.data.map((c: any) => [c.id, c.eligible, c.reason])).toEqual([
    [6, true, null], [5, false, "item_mismatch"], [7, false, "final_status"],
  ]);
  expect(res.body.data[0]).toMatchObject({ operationNumber: "1201", orderNumber: "ON-6", sku: "A", quantity: 2, shipmentStatusLabel: "في المخزن" });
  expect(mockQuery.mock.calls[0][1].replacements).toMatchObject({ sourceOrderId: 1, prefix: "120%", contains: "%120%" });
});

test("already-reassigned orders are not eligible, and no matches skips line lookups", async () => {
  mockQuery
    .mockResolvedValueOnce([row(5, "1200")])
    .mockResolvedValueOnce([line(1), line(5)])
    .mockResolvedValueOnce([{ id: 5 }]);
  const app = appFor({ ship_view: true });
  const res = await request(app).get("/reassignments/candidates?sourceOrderId=1&q=1200");
  expect(res.body.data[0]).toMatchObject({ eligible: false, reason: "already_reassigned" });
  mockQuery.mockReset().mockResolvedValueOnce([]);
  const empty = await request(app).get("/reassignments/candidates?sourceOrderId=1&q=zzz");
  expect(empty.body.data).toEqual([]);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test("reassignment log filters are applied in SQL and validated", async () => {
  expect((await request(appFor({})).get("/reassignments")).status).toBe(403);
  const app = appFor({ ship_view: true });
  expect((await request(app).get("/reassignments?dateFrom=01-09-2026")).status).toBe(400);
  mockQuery.mockResolvedValueOnce([{ id: 1, sku: "A", sellerName: "بائع", amount: 100 }]);
  const res = await request(app).get("/reassignments?oldOrder=12&newOrder=34&code=SK&vendorId=4&dateFrom=2026-09-01&dateTo=2026-09-30");
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual([{ id: 1, sku: "A", sellerName: "بائع", amount: 100 }]);
  const [sql, options] = mockQuery.mock.calls[0];
  expect(sql).toContain(`source.code ILIKE :oldOrder`);
  expect(sql).toContain(`target.code ILIKE :newOrder`);
  expect(sql).toContain(`line.sku ILIKE :code`);
  expect(sql).toContain(`product."vendorId" = :vendorId`);
  expect(sql).toContain(`r."createdAt" >= (:dateFrom)::date`);
  expect(options.replacements).toMatchObject({ oldOrder: "%12%", newOrder: "%34%", code: "%SK%", vendorId: 4, dateTo: "2026-09-30" });
  mockQuery.mockResolvedValueOnce([]);
  await request(app).get("/reassignments");
  expect(mockQuery.mock.calls[1][0]).not.toContain("ILIKE");
});
