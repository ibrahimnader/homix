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
  detail: jest.spyOn(invoiceService, "detail").mockResolvedValue({ adjustments: [], invoice: {}, lines: [] } as never),
  generate: jest.spyOn(invoiceService, "generate").mockResolvedValue({ invoices: [] } as never),
  list: jest.spyOn(invoiceService, "list").mockResolvedValue({ items: [] } as never),
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
  expect(spies.list).toHaveBeenCalledWith(expect.objectContaining({ receipt: "missing", statuses: ["reviewed", "frozen"] }), {});
  await request(finance).post("/financial-invoices/generate").send({ billingDay: 28, referenceDate: "2026-10-20" });
  expect(spies.generate).toHaveBeenCalledWith({ billingDay: 28, referenceDate: "2026-10-20" }, { id: 7 });
});

test("receipt upload requires a file and records it for the actor", async () => {
  expect((await request(finance).post("/financial-invoices/1/receipt")).status).toBe(400);
  expect((await request(finance).post("/financial-invoices/1/receipt").set("x-test-file", "1")).status).toBe(200);
  expect(spies.setReceipt).toHaveBeenCalledWith(1, { name: "r.pdf", path: "uploads/financial-receipts/r-1.pdf" }, { id: 7 });
});
