import express from "express";
import request from "supertest";

const mockQuery = jest.fn();
jest.mock("./shipment.notifications");
const mockLogBulkCreate = jest.fn();
jest.mock("../../../app/modules/logs/log.model", () => ({ bulkCreate: (...args: unknown[]) => mockLogBulkCreate(...args) }));
jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: (...args: unknown[]) => mockQuery(...args), transaction: jest.fn() },
}));
// eslint-disable-next-line import/first
import { reassignmentRouter } from "./reassignment.routes";
// eslint-disable-next-line import/first
import { notifyShipmentStatusChanges } from "./shipment.notifications";

const appFor = (permissions: Record<string, boolean>, userType = "4") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 7, userType, permissions } as never;
    next();
  });
  app.use("/reassignments", reassignmentRouter);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.name === "ZodError" ? 400 : (error.statusCode ?? 500)).json({
      status: false, code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}),
    }));
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
  expect(sql).toContain(`r."createdAt" >= :dateFrom`);
  expect(sql).toContain(`r."createdAt" <= :dateTo`);
  /* Cairo inclusive days (UTC+3 in September): 1 Sep 00:00 Cairo = 31 Aug 21:00Z; 30 Sep 23:59:59.999 Cairo = 30 Sep 20:59:59.999Z */
  expect(options.replacements).toMatchObject({ oldOrder: "%12%", newOrder: "%34%", code: "%SK%", vendorId: 4 });
  expect((options.replacements.dateFrom as Date).toISOString()).toBe("2026-08-31T21:00:00.000Z");
  expect((options.replacements.dateTo as Date).toISOString()).toBe("2026-09-30T20:59:59.999Z");
  mockQuery.mockResolvedValueOnce([]);
  await request(app).get("/reassignments");
  expect(mockQuery.mock.calls[1][0]).not.toContain("ILIKE");
});

describe("reassignment runs through the shared status sync", () => {
  const post = async (reason: string) => {
    const { sequelize } = jest.requireMock("../../infrastructure/database");
    sequelize.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn({ id: "t" }));
    const source = { id: 1, status: 2, shipmentStatus: 3, confirmationStatus: 2, manufactureStatus: 3 };
    const target = { id: 2, status: 1, shipmentStatus: 1, confirmationStatus: 1, manufactureStatus: null };
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM orders") && sql.includes("FOR UPDATE")) return [source, target];
      if (sql.includes('FROM "orderLines"')) return [line(1), line(2)];
      if (sql.includes("INSERT INTO shipment_reassignments")) return [{ id: 99 }];
      return [];
    });
    const res = await request(appFor({ ship_edit: true })).post("/reassignments").send({ sourceOrderId: 1, targetOrderId: 2, reason });
    const updates = mockQuery.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE orders"));
    return { res, updates: updates.map(([, options]) => options.replacements) };
  };

  it("keeps its own rules (source canceled/4+5, target in inventory/8+2) and leaves confirmation as is", async () => {
    const { res, updates } = await post("منتج تالف");
    expect(res.status).toBe(201);
    expect(updates).toEqual([
      { id: 1, status: 4, shipmentStatus: 5, confirmationStatus: 2, manufactureStatus: 3, scheduleStatus: undefined },
      { id: 2, status: 8, shipmentStatus: 2, confirmationStatus: 1, manufactureStatus: 7, scheduleStatus: undefined },
    ]);
    /* the target's manufacture stage follows "in warehouse" (7) through the shared sync, with an auto_sync marker */
    expect(mockLogBulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ action: "auto_sync", entityId: 2, to: "manufactureStatus:->7" })]),
      expect.anything(),
    );
  });

  it("notifies both shipments after the commit, separately, attributed to the user", async () => {
    await post("منتج تالف");
    expect(notifyShipmentStatusChanges).toHaveBeenCalledTimes(2);
    expect(notifyShipmentStatusChanges).toHaveBeenNthCalledWith(1, [{ fromStatus: 3, orderId: 1, toStatus: 5 }], 7);
    expect(notifyShipmentStatusChanges).toHaveBeenNthCalledWith(2, [{ fromStatus: 1, orderId: 2, toStatus: 2 }], 7);
  });

  it("does not notify when the reassignment is rejected", async () => {
    const { sequelize } = jest.requireMock("../../infrastructure/database");
    sequelize.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn({ id: "t" }));
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("FOR UPDATE") ? [] : []));
    const res = await request(appFor({ ship_edit: true })).post("/reassignments").send({ sourceOrderId: 1, targetOrderId: 2, reason: "منتج تالف" });
    expect(res.status).toBe(404);
    expect(notifyShipmentStatusChanges).not.toHaveBeenCalled();
  });

  it("keeps the source pending when the customer still needs the order", async () => {
    const { res, updates } = await post("إعادة تخصيص - العميل لسه محتاج الطلب");
    expect(res.status).toBe(201);
    expect(updates[0]).toEqual({ id: 1, status: 1, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 3, scheduleStatus: undefined });
  });
});

describe("reassignment regression guard", () => {
  const run = async (opts: { source?: Record<string, unknown>; invoiceStatus?: string; body?: Record<string, unknown>; userType?: string }) => {
    const { sequelize } = jest.requireMock("../../infrastructure/database");
    sequelize.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn({ id: "t" }));
    const source = { id: 1, orderNumber: "H1", status: 2, shipmentStatus: 3, confirmationStatus: 2, manufactureStatus: 3, ...opts.source };
    const target = { id: 2, orderNumber: "H2", status: 1, shipmentStatus: 1, confirmationStatus: 1, manufactureStatus: null };
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM orders") && sql.includes("FOR UPDATE")) return [source, target];
      if (sql.includes("financial_invoice_lines")) return opts.invoiceStatus ? [{ orderId: 1, status: opts.invoiceStatus }] : [];
      if (sql.includes('FROM "orderLines"')) return [line(1), line(2)];
      if (sql.includes("INSERT INTO shipment_reassignments")) return [{ id: 99 }];
      return [];
    });
    const res = await request(appFor({ ship_edit: true }, opts.userType))
      .post("/reassignments").send({ sourceOrderId: 1, targetOrderId: 2, reason: "منتج تالف", ...opts.body });
    const writes = mockQuery.mock.calls.filter(([sql]) => /^(UPDATE orders|\s*INSERT)/.test(String(sql)));
    return { res, writes, auditCalls: mockLogBulkCreate.mock.calls.filter(([rows]) => rows.some((row: any) => row.action === "regression_confirmed")) };
  };

  it("409 with details for an order on a reviewed invoice line, nothing written, no notification", async () => {
    const { res, writes, auditCalls } = await run({ invoiceStatus: "reviewed" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: false, code: "REGRESSION_NEEDS_CONFIRMATION" });
    expect(res.body.details.regressions[0]).toMatchObject({ orderId: 1, orderNumber: "H1", reasons: ["invoice_reviewed"] });
    expect(res.body.details.regressions[0].changes.map((change: any) => change.field)).toContain("status");
    expect(writes).toEqual([]);
    expect(auditCalls).toEqual([]);
    expect(notifyShipmentStatusChanges).not.toHaveBeenCalled();
  });
  it("confirmed (true and \"true\"): reassigns and writes the regression_confirmed audit row", async () => {
    for (const flag of [true, "true"]) {
      mockLogBulkCreate.mockClear();
      const { res, writes, auditCalls } = await run({ invoiceStatus: "transferred", body: { confirmRegression: flag } });
      expect(res.status).toBe(201);
      expect(writes.length).toBeGreaterThanOrEqual(3);
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0][0]).toEqual([expect.objectContaining({ action: "regression_confirmed", entityId: 1, entityType: "order", field: "regression", userId: 7 })]);
      expect(auditCalls[0][1]).toEqual({ transaction: { id: "t" } });
    }
  });
  it("vendors get 403 REGRESSION_FORBIDDEN even with the flag, nothing written", async () => {
    const { res, writes } = await run({ invoiceStatus: "frozen", body: { confirmRegression: true }, userType: "2" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("REGRESSION_FORBIDDEN");
    expect(writes).toEqual([]);
  });
  it("a plain reassignment of un-invoiced non-final orders is not flagged and writes no regression audit row", async () => {
    mockLogBulkCreate.mockClear();
    const { res, auditCalls } = await run({});
    expect(res.status).toBe(201);
    expect(auditCalls).toEqual([]);
  });
  it("rejects a non-boolean flag at validation", async () => {
    const { res } = await run({ body: { confirmRegression: "maybe" } });
    expect(res.status).toBe(400);
  });
});
