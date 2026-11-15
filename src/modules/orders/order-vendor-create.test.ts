/* Vendors (userType "2") can never create orders, whatever their permissions; staff are unaffected; the webhook stays open. */
import express from "express";
import request from "supertest";

const mockCurrentUser: { value: Record<string, unknown> } = { value: { id: 1, userType: "1" } };
const legacyOrderService = {
  importOrders: jest.fn(), saveImportedOrders: jest.fn(), sendNotification: jest.fn(),
};

jest.mock("../../../app/middlewares/protectApi", () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  req.user = mockCurrentUser.value as never;
  req.vendorId = null;
  next();
});
jest.mock("../../../app/middlewares/isNotVendor", () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
/* Permission middleware says yes to everyone: the vendor must still be rejected. */
jest.mock("../../../app/middlewares/requirePermission", () => () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
jest.mock("../../../config/fileUploadMiddleware", () => () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
jest.mock("../../infrastructure/database", () => ({ sequelize: { col: jest.fn(), fn: jest.fn(), where: jest.fn(), define: jest.fn() } }));
jest.mock("../../../app/modules/order/order.model", () => ({}));
jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({ refreshRange: jest.fn(), backfill: jest.fn() })),
}));
jest.mock("../dashboard/dashboard-daily-metric.model", () => ({}));
jest.mock("../../../app/modules/vendor/vendor.model", () => ({}));
jest.mock("../../../app/modules/user/user.model", () => ({}));
jest.mock("../../../app/modules/order/order.service", () => legacyOrderService);
for (const path of ["orderLines/orderline.model", "product/product.model", "customer/customer.model", "notes/notes.model",
  "attachments/attachment.model", "product/productType.model", "logs/log.model", "settings/managedOption.model"]) {
  jest.doMock(`../../../app/modules/${path}`, () => ({}));
}
jest.mock("./order.webhook", () => ({
  handleShopifyOrderWebhook: async (_req: express.Request, res: express.Response) => { res.status(200).json({ webhook: "ok" }); },
}));

// eslint-disable-next-line import/first
import { errorMiddleware } from "../../shared/http";
// eslint-disable-next-line import/first
import { orderRouter } from "./order.routes";

const app = express();
app.use(express.json());
app.use("/orders", orderRouter);
app.use(errorMiddleware);

const VENDOR_MESSAGE = "البائع لا يملك صلاحية إنشاء الطلبات";
const validBody = {
  customer: { firstName: "A", lastName: "B", phoneNumber: "01000000000", address: "Cairo" },
  orderDate: "2026-05-01", orderLines: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser.value = { id: 1, userType: "1" };
});

describe("vendors cannot create orders", () => {
  it.each(["/orders", "/orders/import"])("POST %s: a vendor with orders_create is rejected with 403 and an Arabic message", async (path) => {
    mockCurrentUser.value = { id: 5, userType: "2", permissions: { orders_create: true } };
    const response = await request(app).post(path).send(validBody);
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(VENDOR_MESSAGE);
    expect(legacyOrderService.saveImportedOrders).not.toHaveBeenCalled();
    expect(legacyOrderService.importOrders).not.toHaveBeenCalled();
  });

  it("POST /orders/import: staff reach the importer", async () => {
    const response = await request(app).post("/orders/import");
    expect(response.status).toBe(200);
    expect(legacyOrderService.importOrders).toHaveBeenCalledTimes(1);
  });

  it("POST /orders/webhook does not run the vendor check (unauthenticated by design)", async () => {
    mockCurrentUser.value = { id: 5, userType: "2" };
    const response = await request(app).post("/orders/webhook").send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ webhook: "ok" });
  });
});

describe("OrderService.createOrder", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OrderService } = require("./order.service");
  const gateway = { saveImportedOrders: jest.fn(), importOrders: jest.fn() };
  const service = new OrderService({}, gateway);
  (service as unknown as { refreshAggregateForDates: unknown }).refreshAggregateForDates = jest.fn();

  it("lets staff (admin and non-vendor users) create", async () => {
    await expect(service.createOrder(validBody, { id: 1, userType: "1" })).resolves.toBeDefined();
    await expect(service.createOrder(validBody, { id: 2, userType: "3" })).resolves.toBeDefined();
    expect(gateway.saveImportedOrders).toHaveBeenCalledTimes(2);
  });

  it("rejects a vendor user before saving anything", async () => {
    await expect(service.createOrder(validBody, { id: 5, userType: "2" })).rejects.toMatchObject({ statusCode: 403, message: VENDOR_MESSAGE });
  });
});
