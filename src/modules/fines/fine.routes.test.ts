import express from "express";
import request from "supertest";

const mockQuery = jest.fn();
jest.mock("../../../app/middlewares/protectApi", () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock("../../../app/middlewares/isNotVendor", () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: (...args: unknown[]) => mockQuery(...args), transaction: jest.fn() },
}));
// eslint-disable-next-line import/first
import { fineRouter } from "./fine.routes";
// eslint-disable-next-line import/first
import { calculateFineForRule, type FineRule } from "./fine-calculation";

const appFor = (permissions: Record<string, boolean>) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 7, userType: "4", permissions } as never;
    next();
  });
  app.use("/fines", fineRouter);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.name === "ZodError" ? 400 : error.statusCode ?? 500).json({ status: false }));
  return app;
};

beforeEach(() => mockQuery.mockReset());

describe("DELETE /fines/rules/:id", () => {
  test("requires finance_settle", async () => {
    expect((await request(appFor({ finance_view: true })).delete("/fines/rules/3")).status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("soft-deletes instead of removing the row", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 3 }]);
    const res = await request(appFor({ finance_settle: true })).delete("/fines/rules/3");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 3 });
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("UPDATE fine_rules SET \"deletedAt\" = NOW()");
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(mockQuery.mock.calls[0][1].replacements).toEqual({ id: 3 });
  });

  test("404 when missing or already deleted, 400 on a bad id", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const app = appFor({ finance_settle: true });
    expect((await request(app).delete("/fines/rules/3")).status).toBe(404);
    expect((await request(app).delete("/fines/rules/abc")).status).toBe(400);
  });
});

describe("deleted rules are hidden but records keep the rule name", () => {
  test("rule list excludes deleted rules", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await request(appFor({ finance_view: true })).get("/fines/rules");
    expect(String(mockQuery.mock.calls[0][0])).toContain('"deletedAt" IS NULL');
  });

  test("records query joins rules without the deleted filter", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await request(appFor({ finance_view: true })).get("/fines/records");
    expect(String(mockQuery.mock.calls[0][0])).not.toContain("f.\"deletedAt\"");
  });

  test("editing or manually applying a deleted rule is refused by the query", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const body = { name: "قاعدة", description: "", trigger: "manual", amountType: "fixed", amount: 5, frequency: "once", basis: "cost", graceHours: 0, maxAmount: null, effectiveFrom: "2026-10-01T00:00:00.000Z", active: true };
    const res = await request(appFor({ finance_settle: true })).put("/fines/rules/3").send(body);
    expect(res.status).toBe(404);
    expect(String(mockQuery.mock.calls[0][0])).toContain('"deletedAt" IS NULL');
  });

  test("calculation never applies a deleted rule", () => {
    const rule: FineRule = { id: 1, trigger: "delivery_delay", amountType: "fixed", amount: 100, frequency: "once", basis: "cost", graceHours: 0, maxAmount: null, effectiveFrom: "2026-10-01T00:00:00.000Z", active: true };
    const order = { status: 2, orderDate: "2026-10-02T00:00:00.000Z", expectedDeliveryDate: "2026-10-05T00:00:00.000Z", deliveryDate: null, subTotalPrice: 1, totalPrice: 1, commission: 1, totalCost: 1 };
    const now = new Date("2026-10-10T00:00:00.000Z");
    expect(calculateFineForRule(rule, order, now)).toBe(100);
    expect(calculateFineForRule({ ...rule, deletedAt: "2026-10-09T00:00:00.000Z" }, order, now)).toBe(0);
  });
});

describe("GET /fines/records maker and operation number search", () => {
  const app = () => appFor({ finance_view: true, finance_export: true });

  test("adds ILIKE filters with escaped wildcards", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await request(app()).get("/fines/records").query({ vendor: " 50%_ab\\ ", operationNumber: "12_3" });
    expect(res.status).toBe(200);
    const [sql, options] = mockQuery.mock.calls[0];
    expect(sql).toContain("o.code ILIKE :operationLike");
    expect(sql).toContain("vv.name ILIKE :vendorLike");
    expect(options.replacements).toMatchObject({ vendorLike: "%50\\%\\_ab\\\\%", operationLike: "%12\\_3%" });
  });

  test("omits the filters when not provided", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await request(app()).get("/fines/records");
    const [sql, options] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("ILIKE");
    expect(options.replacements).not.toHaveProperty("vendorLike");
  });

  test("rejects empty or oversized values", async () => {
    expect((await request(app()).get("/fines/records").query({ vendor: "   " })).status).toBe(400);
    expect((await request(app()).get("/fines/records").query({ operationNumber: "x".repeat(51) })).status).toBe(400);
  });

  test("export honors the same filters without the row limit", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await request(app()).get("/fines/records/export").query({ vendor: "ab", operationNumber: "9" });
    expect(res.status).toBe(200);
    const [sql, options] = mockQuery.mock.calls[0];
    expect(sql).toContain("vv.name ILIKE :vendorLike");
    expect(sql).not.toContain("LIMIT 2000");
    expect(options.replacements).toMatchObject({ vendorLike: "%ab%", operationLike: "%9%" });
  });
});
