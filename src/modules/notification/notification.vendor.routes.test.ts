import express from "express";
import request from "supertest";

jest.mock("../../../app/middlewares/protectApi", () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  req.user = { id: 21, userType: "2", vendorId: 4, permissions: new Proxy({}, { get: () => true }) } as never;
  next();
});
jest.mock("../../../app/modules/notification/notification.model", () => ({
  destroy: jest.fn().mockResolvedValue(1), findAll: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue([1]),
}));

import { errorMiddleware } from "../../shared/http";
import { notificationRouter } from "./notification.routes";
const model = require("../../../app/modules/notification/notification.model");

describe("notifications as a vendor: mark-all-read / clear only touch the caller's own rows", () => {
  const app = express();
  app.use(express.json());
  app.use("/notifications", notificationRouter);
  app.use(errorMiddleware);

  it("mark-all ignores a userId sent in the body or query", async () => {
    model.update.mockClear();
    await request(app).put("/notifications").send({ userId: 1 }).expect(200);
    expect(model.update.mock.calls[0][1].where).toEqual({ readAt: null, userId: 21 });
  });

  it("clear ignores a userId too", async () => {
    model.destroy.mockClear();
    await request(app).delete("/notifications").send({ userId: 1 });
    expect(model.destroy.mock.calls[0][0].where).toEqual({ userId: 21 });
  });
});
