import express from "express";
import request from "supertest";

jest.mock("../../../app/middlewares/protectApi", () => {
  return (_request: express.Request, _response: express.Response, next: express.NextFunction) => {
    _request.user = { id: 7, userType: "1" };
    next();
  };
});

jest.mock("../../../app/modules/notification/notification.model", () => ({
  destroy: jest.fn().mockResolvedValue(1),
  findAll: jest.fn().mockImplementation((options: { group?: unknown }) =>
    Promise.resolve(
      options.group
        ? [{ count: "2", entityType: "order" }, { count: "1", entityType: "ticket" }]
        : [{ entityType: "ticket", id: 1, readAt: null, text: "hello", userId: 7 }],
    ),
  ),
  update: jest.fn().mockResolvedValue([1]),
}));

import { errorMiddleware } from "../../shared/http";
const notificationModel = require("../../../app/modules/notification/notification.model");
import { notificationRouter } from "./notification.routes";

describe("notificationRouter", () => {
  const app = express();
  app.use(express.json());
  app.use("/notifications", notificationRouter);
  app.use(errorMiddleware);

  it("gets notifications", async () => {
    const response = await request(app).get("/notifications");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.notifications[0].category).toBe("tickets");
    expect(response.body.counts).toEqual({ orders: 2, shipments: 0, tickets: 1, total: 3 });
  });

  it("scopes the list to the authenticated user and filters by category", async () => {
    notificationModel.findAll.mockClear();
    await request(app).get("/notifications?category=shipments").expect(200);

    const listCall = notificationModel.findAll.mock.calls.find(([options]: [{ group?: unknown }]) => !options.group);
    expect(listCall[0].where.userId).toBe(7);
    expect(listCall[0].where.entityType).toBeDefined();
    const countCall = notificationModel.findAll.mock.calls.find(([options]: [{ group?: unknown }]) => options.group);
    expect(countCall[0].where).toEqual({ readAt: null, userId: 7 });
  });

  it("rejects an unknown category", async () => {
    const response = await request(app).get("/notifications?category=vendors");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("marks one category as read", async () => {
    notificationModel.update.mockClear();
    await request(app).put("/notifications").send({ category: "tickets" }).expect(200);
    expect(notificationModel.update.mock.calls[0][1].where.userId).toBe(7);
  });

  it("scopes mark-all to unread rows of the user, and category narrows entityType", async () => {
    notificationModel.update.mockClear();
    await request(app).put("/notifications").send({}).expect(200);
    expect(notificationModel.update.mock.calls[0][1].where).toEqual({ readAt: null, userId: 7 });

    notificationModel.update.mockClear();
    await request(app).put("/notifications").send({ category: "orders" }).expect(200);
    const where = notificationModel.update.mock.calls[0][1].where;
    expect(where.userId).toBe(7);
    expect(where.readAt).toBeNull();
    expect(where.entityType).toBeDefined();
  });

  it("rejects an unknown category on mark-all", async () => {
    const response = await request(app).put("/notifications").send({ category: "bogus" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("marks a single notification as read for the current user only", async () => {
    notificationModel.update.mockClear();
    const response = await request(app).put("/notifications/12/read").send({});
    expect(response.status).toBe(200);
    expect(notificationModel.update.mock.calls[0][1].where).toEqual({ id: 12, readAt: null, userId: 7 });
  });

  it("rejects a non-numeric notification id", async () => {
    const response = await request(app).put("/notifications/abc/read").send({});
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("marks notifications as read", async () => {
    const response = await request(app).put("/notifications").send({});

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Notifications marked as read");
  });
});
