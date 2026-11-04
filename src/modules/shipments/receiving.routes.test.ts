import express from "express";
import request from "supertest";
import { receivingRouter } from "./receiving.routes";

jest.mock("./receiving.service", () => ({
  ReceivingService: jest.fn().mockImplementation(() => ({
    refreshMetrics: jest.fn(),
    list: jest.fn(async () => ({ items: [], totalCount: 0 })),
    receivedVendors: jest.fn(async () => [{ id: 4, name: "Factory A" }]),
    receive: jest.fn(async (input, userId) => ({
      orderIds: input.orderIds,
      receiverName: `user-${userId}`,
    })),
    updateReceipt: jest.fn(async (orderId, input) => ({ orderId, ...input })),
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
test("export route requires receipts-view and rejects a bad factory id", async () => {
  expect((await request(appFor({})).get("/receipts/export")).status).toBe(403);
  expect(
    (await request(appFor({ ship_receipts_view: true })).get("/receipts/export?vendorId=abc")).status
  ).toBe(400);
});
test("receipt factory list needs only receipts-view and returns id/name pairs", async () => {
  expect((await request(appFor({})).get("/receipts/vendors")).status).toBe(403);
  const res = await request(appFor({ ship_receipts_view: true })).get("/receipts/vendors");
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual([{ id: 4, name: "Factory A" }]);
});
test("receipt edit needs ship_edit and validates its body", async () => {
  const view = appFor({ ship_receipts_view: true });
  expect((await request(view).patch("/receipts/5").send({ notes: "x" })).status).toBe(403);
  const edit = appFor({ ship_receipts_view: true, ship_edit: true });
  expect((await request(edit).patch("/receipts/5").send({})).status).toBe(400);
  expect((await request(edit).patch("/receipts/5").send({ manufactureDate: "31-12-2026" })).status).toBe(400);
  const ok = await request(edit).patch("/receipts/5").send({ notes: "تمام" });
  expect(ok.status).toBe(200);
  expect(ok.body.data).toEqual({ orderId: 5, notes: "تمام" });
});
test("received list rejects an unknown voucher state", async () => {
  const app = appFor({ ship_receipts_view: true });
  expect((await request(app).get("/receipts?documentState=maybe")).status).toBe(400);
  expect((await request(app).get("/receipts?documentState=issued&dateFrom=2026-09-01")).status).toBe(200);
});
