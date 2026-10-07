import express from "express";
import request from "supertest";

const customerModel = {
  create: jest.fn(),
  findByPk: jest.fn(),
};

const sequelizeMock = {
  query: jest.fn(),
};

jest.mock("../../../app/modules/customer/customer.model", () => customerModel);
jest.mock("../../infrastructure/database", () => ({ sequelize: sequelizeMock }));
jest.mock("../../../app/middlewares/requirePermission", () => () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());

import { errorMiddleware } from "../../shared/http";
import CustomerRouter = require("../../../app/modules/customer/customer.routes");

const app = express();
app.use(express.json());
app.use("/customers", CustomerRouter);
app.use(errorMiddleware);

describe("customerRouter", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    customerModel.findByPk.mockImplementation(async (customerId: number) => {
      if (customerId === 999) {
        return null;
      }

      const state = {
        address: "الهرم - الجيزة",
        address2: null,
        email: "old@example.com",
        firstName: "عبير",
        id: customerId,
        lastName: "قديم",
        phoneNumber: "01000000000",
        shopifyId: "445566",
        updatedAt: "2026-07-08T10:00:00.000Z",
      };

      return {
        toJSON: () => ({ ...state }),
        update: jest.fn(async (payload: Record<string, unknown>) => {
          Object.assign(state, payload, { updatedAt: "2026-07-08T12:00:00.000Z" });
        }),
      };
    });
  });

  it("updates customer details", async () => {
    const response = await request(app)
      .put("/customers/5")
      .send({
        address: "المعادي - القاهرة",
        firstName: "عبير",
        lastName: "ابوالمجيد",
        phoneNumber: "01155559646",
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data).toEqual(expect.objectContaining({
      address: "المعادي - القاهرة",
      firstName: "عبير",
      id: 5,
      lastName: "ابوالمجيد",
      phoneNumber: "01155559646",
    }));
  });

  it("returns 404 when the customer does not exist", async () => {
    const response = await request(app)
      .put("/customers/999")
      .send({ firstName: "عبير" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: "NOT_FOUND",
      message: "Customer not found",
      status: false,
    });
  });

  it("returns 400 when no editable fields are provided", async () => {
    const response = await request(app)
      .put("/customers/5")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "VALIDATION_ERROR",
      message: "At least one customer field is required",
      status: false,
    });
  });
});

describe("customerRouter list/summary/create", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists customers with order/spend aggregates", async () => {
    sequelizeMock.query
      .mockResolvedValueOnce([
        {
          address: "المعادي - القاهرة",
          createdAt: "2026-07-01T00:00:00.000Z",
          email: "sara@example.com",
          firstName: "سارة",
          id: 5,
          lastName: "محمد",
          lastOrderDate: "2026-07-10T00:00:00.000Z",
          ordersCount: 3,
          phoneNumber: "01000000000",
          shopifyId: null,
          totalSpend: 1500,
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const response = await request(app).get("/customers").query({ page: 1, size: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data.totalCount).toBe(1);
    expect(response.body.data.items[0]).toEqual(expect.objectContaining({
      firstName: "سارة",
      id: 5,
      isManual: true,
      ordersCount: 3,
      totalSpend: 1500,
    }));
  });

  it("returns the customers KPI summary", async () => {
    sequelizeMock.query
      .mockResolvedValueOnce([{ totalCustomers: 50, totalSpend: 403442 }])
      .mockResolvedValueOnce([{ firstName: "سمير", lastName: "حافظ", totalSpend: 66840 }]);

    const response = await request(app).get("/customers/summary");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      topSpender: { name: "سمير حافظ", totalSpend: 66840 },
      totalCustomers: 50,
      totalSpend: 403442,
    });
  });

  it("creates a manual customer with no shopifyId", async () => {
    customerModel.create.mockResolvedValue({
      toJSON: () => ({
        address: "6 أكتوبر",
        createdAt: "2026-07-12T00:00:00.000Z",
        email: "",
        firstName: "محمد",
        id: 77,
        lastName: "علي",
        phoneNumber: "01099999999",
        shopifyId: null,
      }),
    });

    const response = await request(app)
      .post("/customers")
      .send({ address: "6 أكتوبر", firstName: "محمد", lastName: "علي", phoneNumber: "01099999999" });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({ id: 77, shopifyId: null }));
    expect(customerModel.create).toHaveBeenCalledWith(expect.objectContaining({ shopifyId: null }));
  });

  it("rejects a manual customer without a phone number", async () => {
    const response = await request(app)
      .post("/customers")
      .send({ firstName: "محمد" });

    expect(response.status).toBe(400);
    expect(customerModel.create).not.toHaveBeenCalled();
  });
});
