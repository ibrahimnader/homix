import express from "express";
import request from "supertest";
import { errorMiddleware } from "../../shared/http";

const mockQuery = jest.fn();
jest.mock("../../../app/middlewares/protectApi", () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock("../../../app/middlewares/isNotVendor", () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock("../../shared/logger/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: (...args: unknown[]) => mockQuery(...args), transaction: async (callback: (t: unknown) => unknown) => callback({}) },
}));
// eslint-disable-next-line import/first
import { fineRouter } from "./fine.routes";

const appFor = (permissions: Record<string, boolean>) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 7, userType: "4", permissions } as never; next(); });
  app.use("/fines", fineRouter);
  app.use(errorMiddleware);
  return app;
};
const settle = () => appFor({ finance_settle: true });
const validRule = { name: "قاعدة", description: "", trigger: "manual", amountType: "fixed", amount: 5, frequency: "once", basis: "cost", graceHours: 0, maxAmount: null, effectiveFrom: "2026-10-01T00:00:00.000Z", active: true };
beforeEach(() => mockQuery.mockReset());

describe("permissions per route", () => {
  const routes: [string, string, string][] = [
    ["get", "/fines/rules", "finance_view"], ["get", "/fines/summary", "finance_view"], ["get", "/fines/records", "finance_view"],
    ["get", "/fines/records/export", "finance_export"],
    ["post", "/fines/rules", "finance_settle"], ["put", "/fines/rules/1", "finance_settle"], ["delete", "/fines/rules/1", "finance_settle"],
    ["post", "/fines/records/manual", "finance_settle"], ["post", "/fines/records/1/waive", "finance_settle"],
  ];
  test.each(routes)("%s %s needs %s", async (method, url, permission) => {
    const other: Record<string, boolean> = permission === "finance_settle" ? { finance_view: true, finance_export: true } : { finance_settle: true };
    const res = await (request(appFor(other)) as any)[method](url).send({});
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("error shape and Arabic messages", () => {
  test("validation failure returns 400 with a single consistent shape and Arabic text", async () => {
    const res = await request(settle()).post("/fines/rules").send({ ...validRule, name: "ا", amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: false, code: "VALIDATION_ERROR" });
    expect(res.body.message).toContain("اسم القاعدة: من فضلك أدخل حرفين على الأقل");
    expect(res.body.message).toContain("قيمة الغرامة: من فضلك أدخل قيمة أكبر من صفر");
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test("POST /rules inserts the validated, normalised row", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 9 }]);
    const res = await request(settle()).post("/fines/rules").send({ ...validRule, maxAmount: "" });
    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][1].replacements).toMatchObject({ maxAmount: null, amount: 5, description: "" });
  });
  test("PUT/DELETE of a missing or deleted rule is 404 in Arabic", async () => {
    mockQuery.mockResolvedValue([]);
    const put = await request(settle()).put("/fines/rules/99").send(validRule);
    expect(put.status).toBe(404);
    expect(put.body.message).toBe("القاعدة غير موجودة أو تم حذفها");
    expect((await request(settle()).delete("/fines/rules/99")).status).toBe(404);
  });
});

describe("POST /fines/records/:id/waive", () => {
  const body = { reason: "الصانع أثبت أن التأخير بسبب شركة الشحن" };
  test("waives an active record and recomputes orders.fine from non-waived records", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, orderId: 11 }]).mockResolvedValueOnce([]);
    const res = await request(settle()).post("/fines/records/5/waive").send(body);
    expect(res.status).toBe(200);
    expect(String(mockQuery.mock.calls[0][0])).toContain('"waivedAt" IS NULL');
    expect(String(mockQuery.mock.calls[1][0])).toContain('"waivedAt" IS NULL');
  });
  test("already waived -> 409, missing -> 404, short reason -> 400", async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 5 }]);
    const conflict = await request(settle()).post("/fines/records/5/waive").send(body);
    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toBe("تم إلغاء هذه الغرامة من قبل");
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect((await request(settle()).post("/fines/records/6/waive").send(body)).status).toBe(404);
    const short = await request(settle()).post("/fines/records/5/waive").send({ reason: "ab" });
    expect(short.status).toBe(400);
    expect(short.body.message).toContain("سبب الإلغاء");
  });
});

describe("POST /fines/records/manual", () => {
  const rule = { id: 3, trigger: "manual", active: true, amountType: "percent", amount: 10, basis: "cost", maxAmount: 500 };
  const order = { id: 11, subTotalPrice: 1000, totalPrice: 1200, commission: 200, totalCost: 7000 };
  const post = (body: unknown) => request(settle()).post("/fines/records/manual").send(body as object);

  test("by operation number: percent of basis, capped, inserted against the real order id", async () => {
    mockQuery.mockResolvedValueOnce([rule]).mockResolvedValueOnce([order]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    const res = await post({ ruleId: 3, operationNumber: " OP-100 " });
    expect(res.status).toBe(201);
    expect(String(mockQuery.mock.calls[1][0])).toContain("code = :operationNumber");
    expect(mockQuery.mock.calls[1][1].replacements).toEqual({ operationNumber: "OP-100" });
    expect(mockQuery.mock.calls[3][1].replacements).toEqual({ ruleId: 3, orderId: 11, amount: 500 }); // 10% of 7000 = 700, capped at 500
  });
  test("by order id still works", async () => {
    mockQuery.mockResolvedValueOnce([{ ...rule, maxAmount: null }]).mockResolvedValueOnce([order]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    expect((await post({ ruleId: 3, orderId: 11 })).status).toBe(201);
    expect(mockQuery.mock.calls[3][1].replacements.amount).toBe(700);
  });
  test("400 without an order reference, 404 unknown rule/order, 409 inactive rule / duplicate / ambiguous", async () => {
    const none = await post({ ruleId: 3 });
    expect(none.status).toBe(400);
    expect(none.body.message).toContain("رقم العملية");
    mockQuery.mockResolvedValueOnce([]);
    expect((await post({ ruleId: 3, orderId: 1 })).status).toBe(404);
    mockQuery.mockResolvedValueOnce([{ ...rule, active: false }]);
    expect((await post({ ruleId: 3, orderId: 1 })).status).toBe(409);
    mockQuery.mockResolvedValueOnce([rule]).mockResolvedValueOnce([]);
    const noOrder = await post({ ruleId: 3, operationNumber: "X" });
    expect(noOrder.status).toBe(404);
    expect(noOrder.body.message).toMatch(/رقم العملية/);
    mockQuery.mockResolvedValueOnce([rule]).mockResolvedValueOnce([order]).mockResolvedValueOnce([{ id: 2 }]);
    const dup = await post({ ruleId: 3, orderId: 11 });
    expect(dup.status).toBe(409);
    mockQuery.mockResolvedValueOnce([rule]).mockResolvedValueOnce([order, { ...order, id: 12 }]);
    expect((await post({ ruleId: 3, operationNumber: "X" })).status).toBe(409);
  });
  test("non-manual rule -> 400; zero result -> 400", async () => {
    mockQuery.mockResolvedValueOnce([{ ...rule, trigger: "delivery_delay" }]);
    expect((await post({ ruleId: 3, orderId: 11 })).status).toBe(400);
    mockQuery.mockResolvedValueOnce([rule]).mockResolvedValueOnce([{ ...order, totalCost: 0 }]).mockResolvedValueOnce([]);
    expect((await post({ ruleId: 3, orderId: 11 })).status).toBe(400);
  });
});
