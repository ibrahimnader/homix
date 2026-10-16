import moment from "moment-timezone";
import { ReceivingService } from "./receiving.service";
import {
  receivingCreateSchema,
  receivingDocumentSchema,
} from "./receiving.schemas";
import { sequelize } from "../../infrastructure/database";

jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: jest.fn(), transaction: jest.fn() },
}));
jest.mock("../../../app/modules/order/order.model", () => ({
  findByPk: jest.fn(),
}));
jest.mock("../../../app/modules/logs/log.model", () => ({
  bulkCreate: jest.fn(),
  create: jest.fn(),
}));
const Order = require("../../../app/modules/order/order.model");
const Log = require("../../../app/modules/logs/log.model");
const db = sequelize.query as jest.Mock;
const transaction = { id: "receipt-transaction" };
const update = jest.fn();
const input = {
  orderIds: [10, 11],
  receivedDate: "2026-09-30",
  notes: "تغليف سليم",
  senderName: "مندوب المصنع",
};
let eligible: number[];

beforeEach(() => {
  jest.clearAllMocks();
  eligible = input.orderIds;
  update.mockResolvedValue(undefined);
  (sequelize.transaction as jest.Mock).mockImplementation(async (fn) => fn(transaction));
  Order.findByPk.mockImplementation(async (id: number) => ({
    id,
    PoDate: "2026-09-21",
    status: 2,
    shipmentStatus: 1,
    shippingReceiveDate: null,
    deliveryBy: 2,
    shippedFromInventory: false,
    update,
  }));
  db.mockImplementation(async (sql: string, options: any) => {
    if (sql.includes('SELECT "productId", sku, quantity, cost FROM "orderLines"')) return [{ productId: 33, sku: "SKU33", quantity: 1, cost: 1200 }];
    if (sql.includes('SELECT id, quantity FROM "shipmentInventoryItems"')) return [{ id: 55, quantity: 2 }];
    if (sql.includes('"warehouseReceivedBy" IS NOT NULL')) {
      // printDocument's eligibility + lock query
      return eligible.map((orderId) => ({ orderId }));
    }
    if (sql.includes("FOR UPDATE")) return input.orderIds.map((id) => ({ id }));
    if (sql.includes('"warehouseReceivedBy" IS NULL')) {
      // receive()'s eligibility check
      return eligible.map((orderId) => ({ orderId }));
    }
    if (sql.includes("FROM users")) return [{ name: "مسؤول المخزن" }];
    if (sql.includes("nextval(")) return [{ seq: "7" }];
    if (sql.includes('UPDATE orders SET "warehouseReceiptNumber"')) return [];
    if (sql.includes('o."warehouseReceiptNumber" = :number')) {
      return input.orderIds.map((orderId) => ({
        orderId,
        operationNumber: String(orderId),
        orderNumber: "1633",
        productName: "كرسي",
        productSku: `SKU${orderId}`,
        vendorName: "المصنع",
        quantity: 1,
        manufactureDate: "2026-09-21",
        receivedDate: input.receivedDate,
        senderName: input.senderName,
        notes: input.notes,
        documentNumber: options.replacements.number,
        documentIssuedAt: "2026-10-05T00:00:00.000Z",
        receiverName: "مسؤول المخزن",
      }));
    }
    return [];
  });
});

describe("warehouse receiving", () => {
  it("receives several orders atomically and attributes the receiver from the session, not the payload", async () => {
    const result = await new ReceivingService().receive(input, 7);
    expect(result).toEqual({ orderIds: input.orderIds, receiverName: "مسؤول المخزن" });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseReceivedBy: 7,
        warehouseSenderName: input.senderName,
        warehouseReceiptNotes: input.notes,
        status: 8,
        shipmentStatus: 2,
        deliveryBy: 1,
        shippedFromInventory: true,
        shippingReceiveDate: moment
          .tz(input.receivedDate, "YYYY-MM-DD", "Africa/Cairo")
          .toISOString(),
      }),
      { transaction }
    );
    expect(Log.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: 7, field: "status", to: "8" }),
      ]),
      { transaction }
    );
    expect(db).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO warehouse_receipt_movements'), expect.objectContaining({ transaction }));
    for (const [, options] of db.mock.calls) {
      if (options?.transaction) expect(options.transaction).toBe(transaction);
    }
  });
  it("rejects a stale selection without updating any order", async () => {
    eligible = [10];
    await expect(new ReceivingService().receive(input, 7)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects receipt dates before manufacturing and aborts before further writes", async () => {
    await expect(
      new ReceivingService().receive({ ...input, receivedDate: "2026-09-20" }, 7)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("rejects an unknown receiver id", async () => {
    db.mockImplementation(async (sql: string) => {
      if (sql.includes('"warehouseReceivedBy" IS NULL')) return input.orderIds.map((orderId) => ({ orderId }));
      if (sql.includes("FOR UPDATE")) return input.orderIds.map((id) => ({ id }));
      if (sql.includes("FROM users")) return [];
      return [];
    });
    await expect(new ReceivingService().receive(input, 999)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("cancels a receipt by restoring saved states and subtracting its stock", async () => {
    db.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, status, "shipmentStatus", "warehouseReceivedBy" FROM orders')) return [{ id: 10, status: 8, shipmentStatus: 2, warehouseReceivedBy: 7 }];
      if (sql.includes('FROM warehouse_receipt_movements WHERE')) return [{
        id: 91, inventoryItemId: 55, quantity: 2, previousStatus: 2,
        previousShipmentStatus: 1, previousDeliveryBy: 2,
        previousShippedFromInventory: false, previousShippingReceiveDate: null,
      }];
      if (sql.includes('FROM "shipmentInventoryItems" WHERE id')) return [{ quantity: 3 }];
      return [];
    });
    await expect(new ReceivingService().cancel(10, 7)).resolves.toEqual({ orderId: 10 });
    expect(db).toHaveBeenCalledWith(expect.stringContaining('SET quantity = quantity - :quantity'), expect.objectContaining({ replacements: { id: 55, quantity: 2 }, transaction }));
    expect(db).toHaveBeenCalledWith(expect.stringContaining('UPDATE orders SET status = :status'), expect.objectContaining({ replacements: expect.objectContaining({ orderId: 10, status: 2, shipmentStatus: 1, deliveryBy: 2 }), transaction }));
  });
  it("refuses to guess previous states for old receipts", async () => {
    db.mockImplementation(async (sql: string) => sql.includes('SELECT id, status, "shipmentStatus", "warehouseReceivedBy" FROM orders')
      ? [{ id: 10, status: 8, shipmentStatus: 2, warehouseReceivedBy: 7 }] : []);
    await expect(new ReceivingService().cancel(10, 7)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("printing receipt documents", () => {
  it("stamps a shared RCV-YYYY-NNNN number onto already-received orders and returns the document", async () => {
    const result = await new ReceivingService().printDocument([10, 11]);
    const year = moment().tz("Africa/Cairo").year();
    expect(result.number).toBe(`RCV-${year}-0007`);
    expect(result.items).toHaveLength(2);
    expect(db.mock.calls.every(([, options]) => options.transaction === transaction)).toBe(true);
  });
  it("rejects printing for an order that has not been received yet", async () => {
    eligible = [10];
    await expect(new ReceivingService().printDocument([10, 11])).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("receipt validation", () => {
  it("rejects duplicate ids, empty selections, and more than 100 items", () => {
    for (const ids of [
      [],
      [1, 1],
      Array.from({ length: 101 }, (_, i) => i + 1),
    ]) {
      expect(
        receivingCreateSchema.safeParse({ ...input, orderIds: ids }).success
      ).toBe(false);
      expect(
        receivingDocumentSchema.safeParse({ orderIds: ids }).success
      ).toBe(false);
    }
  });
  it("rejects invalid and future dates", () => {
    for (const receivedDate of [
      "2026-02-30",
      "bad date",
      moment().add(2, "days").format("YYYY-MM-DD"),
    ]) {
      expect(
        receivingCreateSchema.safeParse({ ...input, receivedDate }).success
      ).toBe(false);
    }
  });
});
