import express from "express";
import request from "supertest";

jest.mock("../../../app/middlewares/protectApi", () => {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 1, userType: String(req.header("x-test-user-type") ?? "1") };
    next();
  };
});

jest.mock("../../../app/modules/order/order.model", () => ({
  count: jest.fn().mockResolvedValue(12),
  findAll: jest.fn().mockResolvedValue([
    {
      customer: { firstName: "Lamiaa", lastName: "Saeid" },
      id: 1,
      orderDate: new Date("2026-05-01T00:00:00.000Z"),
      orderLines: [
        {
          discount: "0",
          price: "1200",
          product: {
            id: 11,
            title: "غرفة نوم - دريسينج",
            vendor: { id: 5, name: "ركنة للأثاث" },
            vendorId: 5,
          },
          quantity: 1,
        },
      ],
      orderNumber: "31668",
      status: 1,
      totalPrice: "1200",
    },
  ]),
  findOne: jest.fn(),
}));

jest.mock("../../../app/modules/orderLines/orderline.model", () => ({
  count: jest.fn().mockResolvedValue(3),
  findAll: jest.fn().mockResolvedValue([
    {
      discount: "0",
      price: "1200",
      product: {
        id: 11,
        title: "غرفة نوم - دريسينج",
        vendor: { id: 5, name: "ركنة للأثاث" },
        vendorId: 5,
      },
      quantity: 1,
    },
  ]),
  findOne: jest.fn(),
}));

jest.mock("../../../app/modules/product/product.model", () => ({}));

jest.mock("../../../app/modules/customer/customer.model", () => ({}));

jest.mock("../../../app/modules/vendor/vendor.model", () => ({}));

jest.mock("../../../app/modules/notification/notification.model", () => ({
  findAll: jest.fn().mockResolvedValue([
    {
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      entityId: 1,
      entityType: "order",
      id: 99,
      text: "تم اضافة طلب جديد رقم 31668",
    },
  ]),
}));

jest.mock("../../../app/modules/user/user.model", () => ({
  count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
}));

jest.mock("./dashboard-daily-metric.model", () => ({
  findAll: jest.fn().mockResolvedValue([]),
  sync: jest.fn(),
  upsert: jest.fn(),
}));

import { errorMiddleware } from "../../shared/http";
import { dashboardRouter } from "./dashboard.routes";

describe("dashboardRouter", () => {
  const app = express();
  app.use("/dashboard", dashboardRouter);
  app.use(errorMiddleware);

  it("rejects an invalid finance month before querying finance data", async () => {
    const response = await request(app).get("/dashboard/finance").query({ month: "2026-13" });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe(false);
  });

  it("blocks non-admin users from the finance dashboard API", async () => {
    const response = await request(app)
      .get("/dashboard/finance")
      .set("x-test-user-type", "2")
      .query({ month: "2026-05" });

    expect(response.body).toEqual({ message: "Unauthorized", status: false });
  });

  it("returns dashboard cards", async () => {
    const response = await request(app).get("/dashboard/cards").query({
      endDate: "2026-05-02",
      startDate: "2026-05-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.cards).toHaveLength(4);
  });

  it("returns performance widget data", async () => {
    const response = await request(app).get("/dashboard/performance").query({
      endDate: "2026-05-02",
      startDate: "2026-05-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.series).toHaveLength(1);
  });

  it("returns latest activities", async () => {
    const response = await request(app).get("/dashboard/activities").query({
      endDate: "2026-05-02",
      startDate: "2026-05-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.items[0].entityType).toBe("order");
  });

  it("returns latest orders", async () => {
    const response = await request(app).get("/dashboard/latest-orders").query({
      endDate: "2026-05-02",
      startDate: "2026-05-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.items[0].orderNumber).toBe("31668");
  });

  it("returns dashboard cards for a single-day range", async () => {
    const response = await request(app).get("/dashboard/cards").query({
      endDate: "2026-05-01",
      startDate: "2026-05-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.cards).toHaveLength(4);
  });

  it("returns quick actions", async () => {
    const response = await request(app).get("/dashboard/quick-actions").query({
      endDate: "2026-05-02",
      startDate: "2026-05-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.items.length).toBeGreaterThan(0);
  });
});
