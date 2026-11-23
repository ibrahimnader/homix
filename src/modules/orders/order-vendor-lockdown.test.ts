import express from "express";
import path from "path";
import request from "supertest";

import { USER_TYPES } from "../../../config/constants";
import { loadModuleWithMocks } from "../../test-utils/load-module-with-mocks";
import { OrderService } from "./order.service";
import { orderBulkUpdateSchema } from "./order.schemas";

jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({ backfill: jest.fn(), refreshRange: jest.fn() })),
}));

/**
 * Vendor lockdown of the order details page: the financial card pencils, the status/assignee/delivery/priority selects,
 * invoiceNotes and the order-line edit. The API is authoritative: nothing a vendor sends beyond manufactureStatus/notes is written.
 */

const stored = {
  costPrice: 0, deliveryBy: 1, downPayment: 100, id: 7, manufactureStatus: 2, orderNumber: "H7", priority: 1, shipmentStatus: 3,
  shipmentType: "A", shippingFees: 50, status: 2, subTotalPrice: 1000, toBeCollected: 900, totalCost: 600, totalDiscounts: 0, totalPrice: 1050, userId: 3,
};
const vendor = { id: 4, userType: USER_TYPES.VENDOR, vendorId: 1, permissions: { orders_edit: true, orders_edit_financials: true } } as never;

const build = () => {
  const repository = {
    createOrderLog: jest.fn(),
    findInvoiceLockedOrders: jest.fn().mockResolvedValue(new Map()),
    findOrderEntities: jest.fn().mockResolvedValue([stored]),
    findOrderEntity: jest.fn().mockResolvedValue(stored),
    findVendorOwnedOrderIds: jest.fn().mockImplementation(async (ids: number[]) => ids),
  };
  const gateway = {
    bulkUpdate: jest.fn().mockResolvedValue({ message: "ok", status: true }),
    updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
  };
  const service = new OrderService(repository as never, gateway as never);
  (service as unknown as { refreshAggregateForDates: unknown }).refreshAggregateForDates = jest.fn();
  return { gateway, service };
};

const FINANCIAL_CHANGES: Array<[string, unknown]> = [
  ["costPrice", 1], ["shippingFees", 1], ["totalDiscounts", 1], ["downPayment", 1],
  ["totalPrice", 1], ["subTotalPrice", 1], ["toBeCollected", 1], ["totalCost", 1],
];
/** Not money, but decided by Homix: dropped from a vendor payload (silently, like the legacy page sends them back unchanged). */
const STAFF_ONLY_FIELDS: Array<[string, unknown]> = [
  ["status", 5], ["confirmationStatus", 2], ["deliveryStatus", 1], ["priority", 3], ["userId", 9], ["deliveryBy", 2],
  ["shipmentType", "B"], ["invoiceNotes", "سري"], ["vendorId", 99], ["orderDate", "2026-01-01"],
];

describe("PUT /orders/:id (service) as a vendor", () => {
  it.each(FINANCIAL_CHANGES)("%s: 403 and nothing is written, even with orders_edit_financials in the permission map", async (field, value) => {
    const { gateway, service } = build();
    await expect(service.updateOrder(7, { [field]: value } as never, vendor)).rejects.toMatchObject({ statusCode: 403 });
    expect(gateway.updateOrder).not.toHaveBeenCalled();
  });

  it.each(STAFF_ONLY_FIELDS)("%s is stripped from the written payload", async (field, value) => {
    const { gateway, service } = build();
    await service.updateOrder(7, { [field]: value, manufactureStatus: 3, notes: "ملاحظة" } as never, vendor);
    const written = gateway.updateOrder.mock.calls[0][1];
    /* normalisation re-derives some fields from the STORED row; the vendor's value never survives */
    expect(written[field]).not.toEqual(value);
    expect(written).toMatchObject({ manufactureStatus: 3, notes: "ملاحظة" });
  });

  it("still lets the vendor report manufactureStatus and notes", async () => {
    const { gateway, service } = build();
    await service.updateOrder(7, { manufactureStatus: 3, notes: "جاهز" } as never, vendor);
    expect(gateway.updateOrder).toHaveBeenCalledTimes(1);
    const written = gateway.updateOrder.mock.calls[0][1];
    expect(written).toMatchObject({ manufactureStatus: 3, notes: "جاهز" });
    for (const field of ["deliveryBy", "priority", "subTotalPrice", "totalDiscounts"]) {
      if (field in written) expect(written[field]).toEqual((stored as Record<string, unknown>)[field]);
    }
  });

  it("confirmRegression is never honoured: a regressive manufactureStatus is 403 REGRESSION_FORBIDDEN", async () => {
    const { gateway, service } = build();
    (service as unknown as { orderRepository: { findOrderEntity: jest.Mock } }).orderRepository.findOrderEntity.mockResolvedValue({ ...stored, manufactureStatus: 6, status: 5, shipmentStatus: 4 });
    await expect(service.updateOrder(7, { confirmRegression: true, manufactureStatus: 2 } as never, vendor)).rejects.toMatchObject({ code: "REGRESSION_FORBIDDEN", statusCode: 403 });
    expect(gateway.updateOrder).not.toHaveBeenCalled();
  });
});

describe("PUT /orders/bulk-update (service) as a vendor", () => {
  it.each(FINANCIAL_CHANGES)("%s: 403 and nothing is written", async (field, value) => {
    const { gateway, service } = build();
    await expect(service.bulkUpdate({ orderData: { [field]: value }, orderIds: [7] } as never, vendor)).rejects.toMatchObject({ statusCode: 403 });
    expect(gateway.bulkUpdate).not.toHaveBeenCalled();
  });

  it.each(STAFF_ONLY_FIELDS)("%s is stripped from orderData", async (field, value) => {
    const { gateway, service } = build();
    await service.bulkUpdate({ orderData: { [field]: value, manufactureStatus: 3 }, orderIds: [7] } as never, vendor);
    const orderData = gateway.bulkUpdate.mock.calls[0][0].orderData;
    expect(orderData).not.toHaveProperty(field);
    expect(orderData).toMatchObject({ manufactureStatus: 3 });
  });

  it("invoiceNotes is rejected by the bulk schema for everyone", () => {
    expect(orderBulkUpdateSchema.safeParse({ orderData: { invoiceNotes: "x" }, orderIds: [7] }).success).toBe(false);
  });

  it("a vendor deliveryBy edit cannot flip shippedFromInventory", async () => {
    const { gateway, service } = build();
    await service.bulkUpdate({ orderData: { deliveryBy: 1, manufactureStatus: 3 }, orderIds: [7] } as never, vendor);
    expect(gateway.bulkUpdate.mock.calls[0][0].orderData).not.toHaveProperty("shippedFromInventory");
  });

  it("another vendor's order is a 404 for the whole request", async () => {
    const { gateway, service } = build();
    (service as unknown as { orderRepository: { findVendorOwnedOrderIds: jest.Mock } }).orderRepository.findVendorOwnedOrderIds.mockResolvedValue([]);
    await expect(service.bulkUpdate({ orderData: { manufactureStatus: 3 }, orderIds: [7] } as never, vendor)).rejects.toMatchObject({ statusCode: 404 });
    expect(gateway.bulkUpdate).not.toHaveBeenCalled();
  });
});

describe("order creation by a vendor (incl. local: system products)", () => {
  it("is refused before any product id is resolved, so local:<id> cannot read another vendor's product", async () => {
    const gateway = { importOrders: jest.fn(), saveImportedOrders: jest.fn() };
    const service = new OrderService({} as never, gateway as never);
    const body = { line_items: [{ product_id: "local:12", quantity: 1 }] };
    await expect(service.createOrder(body as never, vendor)).rejects.toMatchObject({ statusCode: 403 });
    expect(gateway.saveImportedOrders).not.toHaveBeenCalled();
  });
});

describe("PUT /orderLines/:id (money fields of a line)", () => {
  const ROUTES = path.join(process.cwd(), "app/modules/orderLines/orderLine.routes.ts");
  const updateOrderLine = jest.fn((_req: express.Request, res: express.Response) => { res.json({ status: true }); });
  const buildApp = (user: Record<string, unknown>) => {
    const router = loadModuleWithMocks<express.Router>(ROUTES, {
      "../../middlewares/protectApi": (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.user = user as never; next(); },
      "./orderLine.controller": { addNote: jest.fn(), deleteNote: jest.fn(), updateNote: jest.fn(), updateOrderLine },
    });
    const app = express();
    app.use(express.json());
    app.use("/orderLines", router);
    return app;
  };

  beforeEach(() => updateOrderLine.mockClear());

  it.each(["cost", "itemShipping", "toBeCollected", "notes"])("403s a vendor holding every permission editing %s", async (field) => {
    const response = await request(buildApp({ id: 4, permissions: { orders_edit: true, orders_edit_financials: true }, userType: "2", vendorId: 1 })).put("/orderLines/5").send({ [field]: 1 });
    expect(response.status).toBe(403);
    expect(updateOrderLine).not.toHaveBeenCalled();
  });

  it("still lets an admin edit", async () => {
    expect((await request(buildApp({ id: 1, userType: "1" })).put("/orderLines/5").send({ cost: 1 })).status).toBe(200);
  });
});
