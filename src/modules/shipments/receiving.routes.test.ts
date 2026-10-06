import express from "express";
import request from "supertest";
import { receivingRouter } from "./receiving.routes";

jest.mock("./receiving.service", () => ({
  ReceivingService: jest.fn().mockImplementation(() => ({
    refreshMetrics: jest.fn(),
    list: jest.fn(async () => ({ items: [], totalCount: 0 })),
    receive: jest.fn(async (input, userId) => ({
      orderIds: input.orderIds,
      receiverName: `user-${userId}`,
    })),
    printDocument: jest.fn(async () => ({ number: "RCV-COMBINED", items: [] })),
  })),
}));
const appFor = (permissions: Record<string, boolean>) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 7, userType: "4", permissions } as never;
    next();
  });
  app.use("/receipts", receivingRouter);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.name === "ZodError" ? 400 : 500).json({ status: false })
  );
  return app;
};
const payload = { orderIds: [1], receivedDate: "2026-09-30", notes: "" };

test("receipts-view permission is required for reading receipt records", async () => {
  expect((await request(appFor({})).get("/receipts")).status).toBe(403);
  expect(
    (await request(appFor({ ship_receipts_view: true })).get("/receipts"))
      .status
  ).toBe(200);
});
test("read-only warehouse access cannot register a receipt", async () => {
  expect(
    (
      await request(appFor({ ship_receipts_view: true }))
        .post("/receipts")
        .send(payload)
    ).status
  ).toBe(403);
});
test("receipt creation uses the authenticated receiver, not a submitted user id", async () => {
  const res = await request(
    appFor({ ship_receipts_view: true, ship_edit: true })
  )
    .post("/receipts")
    .send({ ...payload, userId: 999 });
  expect(res.status).toBe(201);
  expect(res.body.data.receiverName).toBe("user-7");
});
test("read-only warehouse access cannot print a receipt document", async () => {
  const res = await request(appFor({ ship_receipts_view: true }))
    .post("/receipts/documents")
    .send({ orderIds: [1, 2] });
  expect(res.status).toBe(403);
});
test("invalid combined-document selections are rejected", async () => {
  const res = await request(
    appFor({ ship_receipts_view: true, ship_edit: true })
  )
    .post("/receipts/documents")
    .send({ orderIds: [1, 1] });
  expect(res.status).toBe(400);
});
