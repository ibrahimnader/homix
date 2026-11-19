import moment from "moment-timezone";
import { ReceivingService, groupOrdersByVendor } from "./receiving.service";
import {
  receivingCreateSchema,
  receivingDocumentSchema,
} from "./receiving.schemas";
import { sequelize } from "../../infrastructure/database";
import { notifyShipmentStatusChanges } from "./shipment.notifications";

jest.mock("./shipment.notifications");
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
  it("sends one aggregated notification call for the receipt, after the transaction, attributed to the receiver", async () => {
    await new ReceivingService().receive(input, 7);
    expect(notifyShipmentStatusChanges).toHaveBeenCalledTimes(1);
    expect(notifyShipmentStatusChanges).toHaveBeenCalledWith(
      [{ orderId: 10, toStatus: 2 }, { orderId: 11, toStatus: 2 }],
      7,
    );
  });
  it("does not notify when the receipt is rejected", async () => {
    eligible = [10];
    await expect(new ReceivingService().receive(input, 7)).rejects.toBeDefined();
    expect(notifyShipmentStatusChanges).not.toHaveBeenCalled();
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
    /* undoing the receipt puts the shipment back to its previous status (1) */
    expect(notifyShipmentStatusChanges).toHaveBeenCalledWith([{ fromStatus: 2, orderId: 10, toStatus: 1 }], 7);
    expect(db).toHaveBeenCalledWith(expect.stringContaining('SET quantity = quantity - :quantity'), expect.objectContaining({ replacements: { id: 55, quantity: 2 }, transaction }));
    expect(db).toHaveBeenCalledWith(expect.stringContaining('UPDATE orders SET status = :status'), expect.objectContaining({ replacements: expect.objectContaining({ orderId: 10, status: 2, shipmentStatus: 1, deliveryBy: 2 }), transaction }));
  });
  it("refuses to guess previous states for old receipts", async () => {
    db.mockImplementation(async (sql: string) => sql.includes('SELECT id, status, "shipmentStatus", "warehouseReceivedBy" FROM orders')
      ? [{ id: 10, status: 8, shipmentStatus: 2, warehouseReceivedBy: 7 }] : []);
    await expect(new ReceivingService().cancel(10, 7)).rejects.toMatchObject({ statusCode: 409 });
    expect(notifyShipmentStatusChanges).not.toHaveBeenCalled();
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

describe("one voucher per factory", () => {
  const vendors: Record<number, number | null> = { 1: 5, 2: 5, 3: 9, 4: null, 5: null };
  let seq: number;
  let stamped: { number: string; ids: number[] }[];
  const mockDb = () => {
    seq = 100;
    stamped = [];
    db.mockImplementation(async (sql: string, options: any) => {
      if (sql.includes('"warehouseReceivedBy" IS NOT NULL')) {
        return (options.replacements.ids as number[]).filter((id) => id in vendors).map((id) => ({ orderId: id, vendorId: vendors[id] }));
      }
      if (sql.includes("nextval(")) return [{ seq: String(++seq) }];
      if (sql.includes('UPDATE orders SET "warehouseReceiptNumber"')) {
        stamped.push({ number: options.replacements.number, ids: options.replacements.ids });
        return [];
      }
      if (sql.includes('o."warehouseReceiptNumber" = :number')) {
        const group = stamped.find((entry) => entry.number === options.replacements.number)!;
        return group.ids.map((orderId) => ({
          orderId, vendorName: vendors[orderId] === 5 ? "مصنع أ" : vendors[orderId] === 9 ? "مصنع ب" : "",
          documentNumber: group.number, documentIssuedAt: "2026-10-05T00:00:00.000Z",
        }));
      }
      return [];
    });
  };
  beforeEach(mockDb);
  const year = () => moment().tz("Africa/Cairo").year();

  it("groups the selection by vendor, one unique number per factory, stamping only its own orders", async () => {
    const result: any = await new ReceivingService().printDocument([3, 1, 2]);
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d: any) => d.number)).toEqual([`RCV-${year()}-0101`, `RCV-${year()}-0102`]);
    expect(new Set(result.documents.map((d: any) => d.number)).size).toBe(2);
    expect(stamped).toEqual([
      { number: `RCV-${year()}-0101`, ids: [1, 2] },
      { number: `RCV-${year()}-0102`, ids: [3] },
    ]);
    expect(result.documents[0]).toMatchObject({ vendorId: 5, vendorName: "مصنع أ", itemCount: 2 });
    expect(result.documents[1]).toMatchObject({ vendorId: 9, itemCount: 1 });
    expect(result.number).toBeUndefined();
    expect(db.mock.calls.every(([, options]) => options.transaction === transaction)).toBe(true);
  });
  it("puts items without a vendor into their own last voucher", async () => {
    const result: any = await new ReceivingService().printDocument([4, 1, 5]);
    expect(result.documents.map((d: any) => [d.vendorId, d.itemCount])).toEqual([[5, 1], [null, 2]]);
    expect(stamped[1]!.ids).toEqual([4, 5]);
  });
  it("keeps the legacy top-level fields for a single-factory selection", async () => {
    const result: any = await new ReceivingService().printDocument([1, 2]);
    expect(result.number).toBe(`RCV-${year()}-0101`);
    expect(result.items).toHaveLength(2);
    expect(result.issuedAt).toBe("2026-10-05T00:00:00.000Z");
    expect(result.documents).toHaveLength(1);
  });
  it("still rejects unreceived/unknown orders and issues no number", async () => {
    await expect(new ReceivingService().printDocument([1, 99])).rejects.toMatchObject({ statusCode: 404 });
    expect(stamped).toHaveLength(0);
  });
  it("keeps the 100-item cap on the whole request", () => {
    expect(receivingDocumentSchema.safeParse({ orderIds: Array.from({ length: 100 }, (_, i) => i + 1) }).success).toBe(true);
    expect(receivingDocumentSchema.safeParse({ orderIds: Array.from({ length: 101 }, (_, i) => i + 1) }).success).toBe(false);
  });
  it("groupOrdersByVendor orders vendors ascending with no-vendor last", () => {
    expect(groupOrdersByVendor([
      { orderId: 1, vendorId: null }, { orderId: 2, vendorId: 9 }, { orderId: 3, vendorId: 2 }, { orderId: 4, vendorId: 9 },
    ])).toEqual([{ vendorId: 2, orderIds: [3] }, { vendorId: 9, orderIds: [2, 4] }, { vendorId: null, orderIds: [1] }]);
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

describe("received list filters", () => {
  it("applies sku, operation, order and factory filters in SQL for list and count", async () => {
    db.mockImplementation(async (sql: string) => (sql.includes("COUNT(*)") ? [{ total: 0 }] : []));
    await new ReceivingService().list({
      page: 2, search: "", sku: "SK1", operationNumber: "OP9", orderNumber: "16", vendorId: 4,
    } as never);
    const calls = db.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [sql, options] of calls) {
      expect(sql).toContain("l.sku ILIKE :sku");
      expect(sql).toContain("o.code ILIKE :operationNumber");
      expect(sql).toContain(`o."orderNumber" ILIKE :orderNumber`);
      expect(sql).toContain(`p."vendorId" = :vendorId`);
      expect(options.replacements).toMatchObject({ sku: "%SK1%", operationNumber: "%OP9%", orderNumber: "%16%", vendorId: 4 });
    }
    expect(calls[0][1].replacements.offset).toBe(20);
  });
  it("omits filter clauses that are not set", async () => {
    db.mockImplementation(async (sql: string) => (sql.includes("COUNT(*)") ? [{ total: 0 }] : []));
    await new ReceivingService().list({ page: 1, search: "" } as never);
    expect(db.mock.calls[0][0]).not.toContain(":sku");
    expect(db.mock.calls[0][0]).not.toContain(":vendorId");
  });
  it("export reuses the same filters without pagination", async () => {
    db.mockResolvedValue([]);
    const rows = await new ReceivingService().exportRows({ search: "", vendorId: 4 } as never);
    expect(rows).toEqual([]);
    expect(db.mock.calls[0][0]).toContain(`p."vendorId" = :vendorId`);
    expect(db.mock.calls[0][0]).not.toContain("OFFSET");
  });
});

describe("received list voucher/date filters", () => {
  it("filters by voucher number/state and a received-date range in SQL", async () => {
    db.mockImplementation(async (sql: string) => (sql.includes("COUNT(*)") ? [{ total: 0 }] : []));
    await new ReceivingService().list({
      page: 1, search: "", documentNumber: "RCV-2026", documentState: "issued", dateFrom: "2026-09-01", dateTo: "2026-09-30",
    } as never);
    for (const [sql, options] of db.mock.calls) {
      expect(sql).toContain(`o."warehouseReceiptNumber" ILIKE :documentNumber`);
      expect(sql).toContain(`o."warehouseReceiptNumber" IS NOT NULL`);
      expect(sql).toContain(`o."shippingReceiveDate" >= :dateFrom`);
      expect(sql).toContain(`o."shippingReceiveDate" <= :dateTo`);
      expect(sql).not.toContain("::date");
      expect(options.replacements).toMatchObject({ documentNumber: "%RCV-2026%" });
      /* Cairo inclusive days (UTC+3 in September) */
      expect((options.replacements.dateFrom as Date).toISOString()).toBe("2026-08-31T21:00:00.000Z");
      expect((options.replacements.dateTo as Date).toISOString()).toBe("2026-09-30T20:59:59.999Z");
    }
    db.mockClear();
    await new ReceivingService().list({ page: 1, search: "", documentState: "none" } as never);
    expect(db.mock.calls[0][0]).toContain(`o."warehouseReceiptNumber" IS NULL`);
  });
});

describe("received list single-day filter (Cairo boundary)", () => {
  it("a receipt stored as Cairo midnight of 14 Nov (13 Nov 22:00Z) falls inside the 14 Nov day window, not the 13th", async () => {
    db.mockImplementation(async (sql: string) => (sql.includes("COUNT(*)") ? [{ total: 0 }] : []));
    await new ReceivingService().list({ page: 1, search: "", date: "2026-11-14" } as never);
    const { replacements } = db.mock.calls[0][1];
    const start = replacements.dateStart as Date;
    const end = replacements.dateEnd as Date;
    const stored = new Date("2026-11-13T22:00:00.000Z");
    expect(db.mock.calls[0][0]).toContain(`o."shippingReceiveDate" >= :dateStart AND o."shippingReceiveDate" <= :dateEnd`);
    expect(stored >= start && stored <= end).toBe(true);
    /* and the previous day's window (13 Nov) excludes it */
    db.mockClear();
    await new ReceivingService().list({ page: 1, search: "", date: "2026-11-13" } as never);
    const prev = db.mock.calls[0][1].replacements;
    expect(stored >= (prev.dateStart as Date) && stored <= (prev.dateEnd as Date)).toBe(false);
  });
});

describe("updateReceipt", () => {
  const row = { id: 10, PoDate: "2026-09-21T00:00:00Z", shippingReceiveDate: "2026-09-30T00:00:00Z", warehouseReceiptNotes: "old" };
  beforeEach(() => {
    db.mockImplementation(async (sql: string) => (sql.includes("FOR UPDATE") ? [row] : []));
  });
  it("updates notes and logs the change", async () => {
    const out = await new ReceivingService().updateReceipt(10, { notes: "جديد" }, 7);
    expect(out).toEqual({ orderId: 10, warehouseReceiptNotes: "جديد" });
    expect(Log.bulkCreate).toHaveBeenCalledWith(
      [expect.objectContaining({ field: "warehouseReceiptNotes", from: "old", to: "جديد", userId: 7 })],
      { transaction }
    );
    const update = db.mock.calls.find(([sql]) => sql.startsWith("UPDATE orders"))!;
    expect(update[0]).toContain(`"warehouseReceiptNotes" = :warehouseReceiptNotes`);
    expect(update[0]).not.toContain("PoDate");
  });
  it("rejects a receipt date in the future and writes nothing", async () => {
    await expect(new ReceivingService().updateReceipt(10, { receiptDate: "2999-01-01" }, 7)).rejects.toThrow("في المستقبل");
    expect(db.mock.calls.some(([sql]) => sql.startsWith("UPDATE orders"))).toBe(false);
  });
  it("rejects a receipt date before the manufacture date (Cairo day) and writes nothing", async () => {
    await expect(new ReceivingService().updateReceipt(10, { receiptDate: "2026-09-20" }, 7)).rejects.toThrow("يسبق تاريخ التصنيع");
    expect(db.mock.calls.some(([sql]) => sql.startsWith("UPDATE orders"))).toBe(false);
  });
  it("accepts the manufacture day itself as the receipt date", async () => {
    const out = await new ReceivingService().updateReceipt(10, { receiptDate: "2026-09-21" }, 7);
    expect(out.shippingReceiveDate).toBe("2026-09-20T21:00:00.000Z");
  });
  it("sets the receipt date as Cairo midnight, logs it, and never touches PoDate", async () => {
    const out = await new ReceivingService().updateReceipt(10, { receiptDate: "2026-09-25" }, 7);
    expect(out).toEqual({ orderId: 10, shippingReceiveDate: "2026-09-24T21:00:00.000Z" });
    expect(Log.bulkCreate).toHaveBeenCalledWith(
      [expect.objectContaining({ field: "shippingReceiveDate", from: "2026-09-30T00:00:00Z", to: "2026-09-24T21:00:00.000Z", userId: 7 })],
      { transaction }
    );
    const update = db.mock.calls.find(([sql]) => sql.startsWith("UPDATE orders"))!;
    expect(update[0]).toContain(`"shippingReceiveDate" = :shippingReceiveDate`);
    expect(update[0]).not.toContain("PoDate");
  });
  it("allows any past receipt date when the order has no manufacture date", async () => {
    db.mockImplementation(async (sql: string) => (sql.includes("FOR UPDATE") ? [{ ...row, PoDate: null }] : []));
    const out = await new ReceivingService().updateReceipt(10, { receiptDate: "2020-01-01" }, 7);
    expect(out.shippingReceiveDate).toBe("2019-12-31T22:00:00.000Z");
  });
  it("404s for an item that is not received", async () => {
    db.mockResolvedValue([]);
    await expect(new ReceivingService().updateReceipt(99, { notes: "x" }, 7)).rejects.toThrow("غير مستلم");
  });
});

describe("receivedVendors", () => {
  it("lists every non-deleted named vendor ordered by name, not only vendors with received items", async () => {
    db.mockResolvedValue([{ id: 4, name: "Factory A" }]);
    const rows = await new ReceivingService().receivedVendors();
    expect(rows).toEqual([{ id: 4, name: "Factory A" }]);
    const sql = db.mock.calls[0][0];
    expect(sql).toContain("FROM vendors v");
    expect(sql).toContain(`v."deletedAt" IS NULL`);
    expect(sql).toContain("ORDER BY v.name");
    expect(sql).not.toContain("warehouseReceivedBy");
    expect(sql).not.toContain("orders");
  });
});

describe("candidate filters", () => {
  const countOrRows = async (sql: string) => (sql.includes("COUNT(*)") ? [{ total: 0 }] : []);
  it("applies sku, operation, order and factory filters in SQL for items and count", async () => {
    db.mockImplementation(countOrRows);
    await new ReceivingService().candidates({
      page: 2, search: "", sku: "SK1", operationNumber: "OP9", orderNumber: "16", vendorId: 4,
    } as never);
    expect(db.mock.calls).toHaveLength(2);
    for (const [sql, options] of db.mock.calls) {
      expect(sql).toContain("l.sku ILIKE :sku");
      expect(sql).toContain("o.code ILIKE :operationNumber");
      expect(sql).toContain(`o."orderNumber" ILIKE :orderNumber`);
      expect(sql).toContain(`p."vendorId" = :vendorId`);
      expect(sql).toContain(`o."warehouseReceivedBy" IS NULL`);
      expect(options.replacements).toMatchObject({ sku: "%SK1%", operationNumber: "%OP9%", orderNumber: "%16%", vendorId: 4 });
    }
    expect(db.mock.calls[0][1].replacements.offset).toBe(20);
  });
  it("omits unset filters but keeps the legacy combined search working", async () => {
    db.mockImplementation(countOrRows);
    await new ReceivingService().candidates({ page: 1, search: "abc" } as never);
    const [sql, options] = db.mock.calls[0];
    expect(sql).not.toContain(":sku");
    expect(sql).not.toContain(":vendorId");
    expect(sql).toContain("o.code ILIKE :search");
    expect(options.replacements.search).toBe("%abc%");
  });
  it("escapes LIKE wildcards so user input matches literally", async () => {
    db.mockImplementation(countOrRows);
    await new ReceivingService().candidates({ page: 1, search: "", sku: "50%_a\\b" } as never);
    expect(db.mock.calls[0][1].replacements.sku).toBe("%50\\%\\_a\\\\b%");
  });
});
