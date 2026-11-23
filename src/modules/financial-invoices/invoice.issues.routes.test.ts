import express from "express";
import request from "supertest";

jest.mock("../../infrastructure/database", () => ({ sequelize: { query: jest.fn(), transaction: jest.fn() } }));
jest.mock("../orders/order.repo", () => ({ OrderRepository: class { public getFinancialReport = jest.fn(); } }));
jest.mock("../../../config/fileUploadMiddleware", () => () => (req: any, _res: any, next: any) => next());
// eslint-disable-next-line import/first
import { invoiceRouter } from "./invoice.routes";
// eslint-disable-next-line import/first
import { InvoiceIssuesService } from "./invoice.issues.service";

const find = jest.spyOn(InvoiceIssuesService.prototype, "find").mockResolvedValue({ counts: { errors: 0, total: 0, warnings: 0 }, issues: [], scopedInvoices: 0, truncated: false });

const appFor = (user: Record<string, unknown>) => {
  const app = express();
  app.use((req, _res, next) => { req.user = user as never; next(); });
  app.use("/financial-invoices", invoiceRouter);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? (error.name === "ZodError" ? 400 : 500)).json({ status: false }));
  return app;
};
beforeEach(() => find.mockClear());

test("staff with finance_settle can read issues; query is validated", async () => {
  const staff = appFor({ id: 7, permissions: { finance_settle: true, finance_view: true }, userType: "4" });
  expect((await request(staff).get("/financial-invoices/issues?month=2026-10&billingDay=28&vendorId=3")).status).toBe(200);
  expect(find).toHaveBeenCalledWith({ billingDay: 28, month: "2026-10", vendorId: 3 });
  expect((await request(staff).get("/financial-invoices/issues?month=2026-13")).status).toBe(400);
});

test("vendors and staff without finance_settle get 403", async () => {
  expect((await request(appFor({ id: 9, permissions: { finance_settle: true, finance_view: true }, userType: "2", vendorId: 5 })).get("/financial-invoices/issues")).status).toBe(403);
  expect((await request(appFor({ id: 8, permissions: { finance_view: true }, userType: "4" })).get("/financial-invoices/issues")).status).toBe(403);
  expect(find).not.toHaveBeenCalled();
});
