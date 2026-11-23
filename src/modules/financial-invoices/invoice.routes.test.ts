import express from "express";
import request from "supertest";

jest.mock("../../infrastructure/database", () => ({ sequelize: { query: jest.fn(), transaction: jest.fn() } }));
jest.mock("../orders/order.repo", () => ({ OrderRepository: class { public getFinancialReport = jest.fn(); } }));
jest.mock("../../../config/fileUploadMiddleware", () => () => (req: any, _res: any, next: any) => {
  req.filePaths = req.headers["x-test-file"] ? ["uploads/financial-receipts/r-1.pdf"] : [];
  req.fileNames = req.headers["x-test-file"] ? ["r.pdf"] : [];
  next();
});
// eslint-disable-next-line import/first
import { invoiceRouter, invoiceService } from "./invoice.routes";

const spies = {
  activity: jest.spyOn(invoiceService, "activity").mockResolvedValue({ page: 1, rows: [], size: 50, total: 0 } as never),
  addAdjustment: jest.spyOn(invoiceService, "addAdjustment").mockResolvedValue({ netAmount: 1 } as never),
  bulkTransition: jest.spyOn(invoiceService, "bulkTransition").mockResolvedValue({ results: [], succeeded: 0 } as never),
  cycleOverview: jest.spyOn(invoiceService, "cycleOverview").mockResolvedValue({ includedOrderIds: {}, invoices: [], lines: [] } as never),
  detail: jest.spyOn(invoiceService, "detail").mockResolvedValue({ adjustments: [], invoice: {}, lines: [] } as never),
  ensureLiveDraft: jest.spyOn(invoiceService, "ensureLiveDraft").mockResolvedValue({ invoiceId: 3, created: true } as never),
  liveAddOrder: jest.spyOn(invoiceService, "liveAddOrder").mockResolvedValue({ netAmount: 1 } as never),
  liveLineAction: jest.spyOn(invoiceService, "liveLineAction").mockResolvedValue({ state: "frozen" } as never),
  liveOrderCandidates: jest.spyOn(invoiceService, "liveOrderCandidates").mockResolvedValue([] as never),
  generate: jest.spyOn(invoiceService, "generate").mockResolvedValue({ invoices: [] } as never),
  invoicedLines: jest.spyOn(invoiceService, "invoicedLines").mockResolvedValue({ items: [] } as never),
  reviewLive: jest.spyOn(invoiceService, "reviewLive").mockResolvedValue({ alreadyReviewed: false } as never),
  reviewLiveAll: jest.spyOn(invoiceService, "reviewLiveAll").mockResolvedValue({ results: [], succeeded: 0 } as never),
  vendorOptions: jest.spyOn(invoiceService, "vendorOptions").mockResolvedValue([{ id: 1, name: "ركة" }] as never),
  list: jest.spyOn(invoiceService, "list").mockResolvedValue({ items: [] } as never),
  refreshDraft: jest.spyOn(invoiceService, "refreshDraft").mockResolvedValue({ refreshed: 0 } as never),
  setOverrides: jest.spyOn(invoiceService, "setOverrides").mockResolvedValue({} as never),
  setReceipt: jest.spyOn(invoiceService, "setReceipt").mockResolvedValue(undefined as never),
  transition: jest.spyOn(invoiceService, "transition").mockResolvedValue({ id: 1 } as never),
};

const appFor = (user: Record<string, unknown>) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user as never; next(); });
  app.use("/financial-invoices", invoiceRouter);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.statusCode ?? (error.name === "ZodError" ? 400 : 500)).json({ status: false, message: error.message }));
  return app;
};
const finance = appFor({ id: 7, permissions: { finance_settle: true, finance_view: true }, userType: "4" });
const viewer = appFor({ id: 8, permissions: { finance_view: true }, userType: "3" });
const vendor = appFor({ id: 9, permissions: { finance_settle: true, finance_view: true }, userType: "2", vendorId: 5 });
const orphanVendor = appFor({ id: 10, permissions: { finance_view: true }, userType: "2", vendorId: null });

beforeEach(() => Object.values(spies).forEach((spy) => spy.mockClear()));

test("reads need finance_view", async () => {
  expect((await request(appFor({ id: 1, permissions: {}, userType: "3" })).get("/financial-invoices")).status).toBe(403);
  expect((await request(finance).get("/financial-invoices")).status).toBe(200);
});

test("vendor reads are scoped by the token, never by the query", async () => {
  await request(vendor).get("/financial-invoices?vendorId=99&status=draft");
  expect(spies.list).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 99 }), { vendorId: 5 });
  await request(vendor).get("/financial-invoices/12");
  expect(spies.detail).toHaveBeenCalledWith(12, { vendorId: 5 });
});

test("a vendor account without vendorId is rejected, not treated as unscoped", async () => {
  expect((await request(orphanVendor).get("/financial-invoices")).status).toBe(403);
  expect(spies.list).not.toHaveBeenCalled();
});

test("vendors cannot mutate or read staff-only resources even with the permission keys", async () => {
  for (const call of [
    () => request(vendor).post("/financial-invoices/generate").send({ billingDay: 13 }),
    () => request(vendor).post("/financial-invoices/1/transition").send({ to: "reviewed" }),
    () => request(vendor).post("/financial-invoices/1/adjustments").send({ amount: 5, kind: "addition", label: "x" }),
    () => request(vendor).post("/financial-invoices/bulk-transition").send({ ids: [1], to: "reviewed" }),
    () => request(vendor).post("/financial-invoices/1/receipt"),
    () => request(vendor).get("/financial-invoices/activity"),
  ]) {
    expect((await call()).status).toBe(403);
  }
  expect(spies.generate).not.toHaveBeenCalled();
  expect(spies.transition).not.toHaveBeenCalled();
  expect(spies.addAdjustment).not.toHaveBeenCalled();
  expect(spies.activity).not.toHaveBeenCalled();
});

test("mutations need finance_settle", async () => {
  expect((await request(viewer).post("/financial-invoices/1/transition").send({ to: "reviewed" })).status).toBe(403);
  expect(spies.transition).not.toHaveBeenCalled();
  expect((await request(finance).post("/financial-invoices/1/transition").send({ to: "reviewed" })).status).toBe(200);
  expect(spies.transition).toHaveBeenCalledWith(1, "reviewed", { transferAmount: undefined }, { id: 7 });
});

test("validation: bad status, bad billing day, transferAmount on a non-transfer, non-positive adjustment", async () => {
  expect((await request(finance).post("/financial-invoices/1/transition").send({ to: "paid" })).status).toBe(400);
  expect((await request(finance).post("/financial-invoices/generate").send({ billingDay: 15 })).status).toBe(400);
  expect((await request(finance).post("/financial-invoices/1/transition").send({ to: "reviewed", transferAmount: 5 })).status).toBe(400);
  expect((await request(finance).post("/financial-invoices/1/adjustments").send({ amount: 0, kind: "addition", label: "x" })).status).toBe(400);
  expect((await request(finance).get("/financial-invoices?size=9999")).status).toBe(400);
  expect(spies.transition).not.toHaveBeenCalled();
});

test("status filter is parsed from a comma list and the actor is the authenticated user", async () => {
  await request(finance).get("/financial-invoices?status=reviewed,frozen&receipt=missing");
  expect(spies.list).toHaveBeenCalledWith(expect.objectContaining({ receipt: "missing", statuses: ["reviewed", "frozen"] }), { canSettle: true });
  await request(finance).post("/financial-invoices/generate").send({ billingDay: 28, referenceDate: "2026-10-20" });
  expect(spies.generate).toHaveBeenCalledWith({ billingDay: 28, referenceDate: "2026-10-20" }, { id: 7 });
});

test("receipt upload requires a file and records it for the actor", async () => {
  expect((await request(finance).post("/financial-invoices/1/receipt")).status).toBe(400);
  expect((await request(finance).post("/financial-invoices/1/receipt").set("x-test-file", "1")).status).toBe(200);
  expect(spies.setReceipt).toHaveBeenCalledWith(1, { name: "r.pdf", path: "uploads/financial-receipts/r-1.pdf" }, { id: 7 });
});

test("cycle overview: needs finance_view, validates periodEnd and scopes vendors by the token", async () => {
  expect((await request(appFor({ id: 1, permissions: {}, userType: "3" })).get("/financial-invoices/cycle?periodEnd=2026-10-28")).status).toBe(403);
  expect((await request(finance).get("/financial-invoices/cycle")).status).toBe(400);
  expect((await request(finance).get("/financial-invoices/cycle?periodEnd=28-10-2026")).status).toBe(400);
  expect(spies.cycleOverview).not.toHaveBeenCalled();
  expect((await request(finance).get("/financial-invoices/cycle?periodEnd=2026-10-28&vendorId=4")).status).toBe(200);
  expect(spies.cycleOverview).toHaveBeenCalledWith({ periodEnd: "2026-10-28", vendorId: 4 }, { canSettle: true });
  await request(vendor).get("/financial-invoices/cycle?periodEnd=2026-10-28&vendorId=99");
  expect(spies.cycleOverview).toHaveBeenLastCalledWith({ periodEnd: "2026-10-28", vendorId: 99 }, { vendorId: 5 });
  expect((await request(orphanVendor).get("/financial-invoices/cycle?periodEnd=2026-10-28")).status).toBe(403);
  expect(spies.detail).not.toHaveBeenCalled();
});

test("refresh is staff-only with finance_settle; overrides accept cost/collection and reject negatives", async () => {
  expect((await request(vendor).post("/financial-invoices/1/refresh")).status).toBe(403);
  expect((await request(viewer).post("/financial-invoices/1/refresh")).status).toBe(403);
  expect((await request(finance).post("/financial-invoices/1/refresh")).status).toBe(200);
  expect(spies.refreshDraft).toHaveBeenCalledWith(1, { id: 7 });
  expect((await request(finance).patch("/financial-invoices/1/lines/2").send({ warehouseCostOverride: 10, collectionOverride: null })).status).toBe(200);
  expect(spies.setOverrides).toHaveBeenCalledWith(1, 2, { collectionOverride: null, warehouseCostOverride: 10 }, { id: 7 });
  expect((await request(finance).patch("/financial-invoices/1/lines/2").send({ warehouseCostOverride: -1 })).status).toBe(400);
  expect((await request(finance).patch("/financial-invoices/1/lines/2").send({})).status).toBe(400);
});

test("vendor shipping override is accepted (and cleared with null), rejects negatives, and is staff-only", async () => {
  expect((await request(finance).patch("/financial-invoices/1/lines/2").send({ vendorShippingCostOverride: 75.5 })).status).toBe(200);
  expect(spies.setOverrides).toHaveBeenLastCalledWith(1, 2, { vendorShippingCostOverride: 75.5 }, { id: 7 });
  expect((await request(finance).patch("/financial-invoices/1/lines/2").send({ vendorShippingCostOverride: null })).status).toBe(200);
  expect(spies.setOverrides).toHaveBeenLastCalledWith(1, 2, { vendorShippingCostOverride: null }, { id: 7 });
  expect((await request(finance).patch("/financial-invoices/1/lines/2").send({ vendorShippingCostOverride: -1 })).status).toBe(400);
  expect((await request(vendor).patch("/financial-invoices/1/lines/2").send({ vendorShippingCostOverride: 1 })).status).toBe(403);
});

test("invoiced lines: separate filters and a vendor id list are validated and parsed", async () => {
  await request(finance).get("/financial-invoices/lines?operationNumber=OP-1&orderNumber=316&productCode=rka&invoiceCode=INV-2026&vendorId=3,4&q=old");
  expect(spies.invoicedLines).toHaveBeenCalledWith(
    expect.objectContaining({ invoiceCode: "INV-2026", operationNumber: "OP-1", orderNumber: "316", productCode: "rka", q: "old", vendorId: [3, 4] }), { canSettle: true });
  expect((await request(finance).get("/financial-invoices/lines?vendorId=abc")).status).toBe(400);
  expect((await request(finance).get("/financial-invoices/lines?operationNumber=")).status).toBe(400);
});

test("invoiced lines: a vendor token is the scope, whatever vendor list is sent", async () => {
  await request(vendor).get("/financial-invoices/lines?vendorId=99,100");
  expect(spies.invoicedLines).toHaveBeenCalledWith(expect.objectContaining({ vendorId: [99, 100] }), { vendorId: 5 });
});

test("vendor options: staff with finance_view only, never vendors", async () => {
  expect((await request(vendor).get("/financial-invoices/vendors")).status).toBe(403);
  expect((await request(appFor({ id: 1, permissions: {}, userType: "3" })).get("/financial-invoices/vendors")).status).toBe(403);
  const ok = await request(finance).get("/financial-invoices/vendors");
  expect(ok.status).toBe(200);
  expect(ok.body.data).toEqual([{ id: 1, name: "ركة" }]);
});

test("archive list accepts a separate invoiceCode filter", async () => {
  await request(finance).get("/financial-invoices?invoiceCode=INV-9&vendorId=4");
  expect(spies.list).toHaveBeenCalledWith(expect.objectContaining({ invoiceCode: "INV-9", vendorId: 4 }), { canSettle: true });
});

test("review-live: staff with finance_settle only, validated body, actor from the token", async () => {
  const body = { billingDay: 28, referenceDate: "2026-10-20", vendorId: 4 };
  expect((await request(vendor).post("/financial-invoices/review-live").send(body)).status).toBe(403);
  expect((await request(vendor).post("/financial-invoices/review-live-all").send({ billingDay: 28 })).status).toBe(403);
  expect((await request(viewer).post("/financial-invoices/review-live").send(body)).status).toBe(403);
  expect((await request(finance).post("/financial-invoices/review-live").send({ billingDay: 28 })).status).toBe(400);
  expect((await request(finance).post("/financial-invoices/review-live").send({ ...body, billingDay: 15 })).status).toBe(400);
  expect(spies.reviewLive).not.toHaveBeenCalled();
  expect((await request(finance).post("/financial-invoices/review-live").send(body)).status).toBe(200);
  expect(spies.reviewLive).toHaveBeenCalledWith(body, { id: 7 });
  expect((await request(finance).post("/financial-invoices/review-live-all").send({ billingDay: 13 })).status).toBe(200);
  expect(spies.reviewLiveAll).toHaveBeenCalledWith({ billingDay: 13 }, { id: 7 });
});

describe("live-row actions", () => {
  const body = { action: "freeze", billingDay: 28, orderId: 100, referenceDate: "2026-11-28", vendorId: 5 };

  test("staff with finance_settle reach the service with the actor; vendor and view-only get 403", async () => {
    const response = await request(finance).post("/financial-invoices/live/line-action").send(body);
    expect(response.status).toBe(200);
    expect(spies.liveLineAction).toHaveBeenCalledWith(expect.objectContaining({ action: "freeze", orderId: 100, vendorId: 5 }), { id: 7 });
    expect((await request(finance).post("/financial-invoices/live/ensure-draft").send({ billingDay: 28, vendorId: 5 })).body.data).toMatchObject({ invoiceId: 3 });
    expect((await request(finance).post("/financial-invoices/live/lines").send({ billingDay: 28, orderId: 100, vendorId: 5 })).status).toBe(200);
    expect((await request(finance).get("/financial-invoices/live/order-candidates?vendorId=5&q=31")).status).toBe(200);
    expect(spies.liveOrderCandidates).toHaveBeenCalledWith(5, "31");
    spies.liveLineAction.mockClear();
    for (const app of [vendor, viewer]) {
      expect((await request(app).post("/financial-invoices/live/line-action").send(body)).status).toBe(403);
      expect((await request(app).post("/financial-invoices/live/lines").send(body)).status).toBe(403);
      expect((await request(app).post("/financial-invoices/live/ensure-draft").send(body)).status).toBe(403);
      expect((await request(app).get("/financial-invoices/live/order-candidates?vendorId=5&q=31")).status).toBe(403);
    }
    expect(spies.liveLineAction).not.toHaveBeenCalled();
  });

  test("validates the body (unknown action, bad billing day)", async () => {
    expect((await request(finance).post("/financial-invoices/live/line-action").send({ ...body, action: "nuke" })).status).toBe(400);
    expect((await request(finance).post("/financial-invoices/live/line-action").send({ ...body, billingDay: 5 })).status).toBe(400);
  });
});

test("vendor bank scope: only finance_settle staff get canSettle; viewers do not; a vendor is scoped to his own id (never canSettle)", async () => {
  await request(finance).get("/financial-invoices/12");
  expect(spies.detail).toHaveBeenLastCalledWith(12, { canSettle: true });
  await request(viewer).get("/financial-invoices/12");
  expect(spies.detail).toHaveBeenLastCalledWith(12, { canSettle: false });
  await request(vendor).get("/financial-invoices/12");
  expect(spies.detail).toHaveBeenLastCalledWith(12, { vendorId: 5 });
});
