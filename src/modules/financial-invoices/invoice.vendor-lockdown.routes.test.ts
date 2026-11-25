import express from "express";
import request from "supertest";

jest.mock("../../infrastructure/database", () => ({ sequelize: { query: jest.fn(), transaction: jest.fn() } }));
jest.mock("../orders/order.repo", () => ({ OrderRepository: class { public getFinancialReport = jest.fn(); } }));
jest.mock("../../../config/fileUploadMiddleware", () => () => (req: any, _res: any, next: any) => { req.filePaths = []; req.fileNames = []; next(); });
// eslint-disable-next-line import/first
import { invoiceRouter, invoiceService } from "./invoice.routes";

/** Every financial-invoice route except the vendor reads is staff-only (finance_settle / staff finance_view), set and reset alike. */
const VENDOR_READS = new Set(["get /", "get /cycle", "get /lines", "get /months", "get /:id", "get /:id/receipt", "get /:id/receipts", "get /:id/receipts/:receiptId"]);
const everyPermission = new Proxy({}, { get: () => true });

const serviceMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(invoiceService)).filter((name) => name !== "constructor");
const spies = serviceMethods.map((name) => jest.spyOn(invoiceService as never, name as never).mockResolvedValue({ items: [], lines: [], invoices: [], results: [] } as never));

const appFor = (user: Record<string, unknown>) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user as never; next(); });
  app.use("/financial-invoices", invoiceRouter);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? (error.name === "ZodError" ? 400 : 500)).json({ status: false }));
  return app;
};

const routes = (invoiceRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
  .filter((layer) => layer.route)
  .flatMap((layer) => Object.keys(layer.route!.methods).map((method) => ({ key: `${method} ${layer.route!.path}`, method, path: layer.route!.path })));
const concrete = (path: string) => path.replace(/:\w+/g, "1");

beforeEach(() => spies.forEach((spy) => spy.mockClear()));

const vendor = appFor({ id: 9, permissions: everyPermission, userType: "2", vendorId: 5 });
const financeNoSettle = appFor({ id: 7, permissions: { finance_view: true }, userType: "4" });

test("enumeration found the routes this test is about", () => {
  expect(routes.length).toBeGreaterThan(20);
  const keys = routes.map((r) => r.key);
  expect(keys).toEqual(expect.arrayContaining(["post /review-live", "post /review-live-all", "patch /:id/lines/:lineId", "post /:id/lines/:lineId/action"]));
});

describe.each(routes.filter((r) => !VENDOR_READS.has(r.key)))("$method $path", ({ method, path }) => {
  it("403 for a vendor holding every permission key; the service is never called", async () => {
    const response = await (request(vendor) as any)[method](`/financial-invoices${concrete(path)}`).send({});
    expect(response.status).toBe(403);
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe("overrides and reviews", () => {
  const body = { vendorShippingCostOverride: 10, reason: "x" };
  test("set and reset of vendorShippingCostOverride (and every other override) is refused for a vendor, before validation", async () => {
    for (const payload of [body, { vendorShippingCostOverride: null }, { finesOverride: 0 }, { collectionOverride: 5 }, { companyDueOverride: 1 }, { vendorDueOverride: 1 }, { warehouseCostOverride: 1 }]) {
      expect((await request(vendor).patch("/financial-invoices/1/lines/2").send(payload)).status).toBe(403);
    }
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test("staff without finance_settle cannot override or review either", async () => {
    expect((await request(financeNoSettle).patch("/financial-invoices/1/lines/2").send(body)).status).toBe(403);
    expect((await request(financeNoSettle).post("/financial-invoices/review-live").send({ billingDay: 28, vendorId: 5 })).status).toBe(403);
    expect((await request(financeNoSettle).post("/financial-invoices/review-live-all").send({ billingDay: 28 })).status).toBe(403);
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test("the vendor reads that remain are scoped by the token, never the query (strip happens in the service: see invoice.service.test)", async () => {
    const list = jest.spyOn(invoiceService, "list");
    await request(vendor).get("/financial-invoices?vendorId=99&status=draft,frozen");
    expect(list).toHaveBeenCalledWith(expect.anything(), { vendorId: 5 });
    const cycle = jest.spyOn(invoiceService, "cycleOverview");
    await request(vendor).get("/financial-invoices/cycle?periodEnd=2026-10-28&vendorId=99");
    expect(cycle).toHaveBeenCalledWith(expect.anything(), { vendorId: 5 });
    const lines = jest.spyOn(invoiceService, "invoicedLines");
    await request(vendor).get("/financial-invoices/lines?vendorId=99");
    expect(lines).toHaveBeenCalledWith(expect.anything(), { vendorId: 5 });
  });
});
