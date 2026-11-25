import { InvoiceIssuesService } from "./invoice.issues.service";

test("pendingShipments labels the shipment status and marks blank ones", async () => {
  const findPendingShipmentOrders = jest.fn().mockResolvedValue([
    { code: "A", deliveryDate: "2026-10-20", id: 1, orderNumber: "1", shipmentStatus: 1, totalPrice: 10, vendorId: 3, vendorName: "V" },
    { code: "B", deliveryDate: "2026-10-21", id: 2, orderNumber: "2", shipmentStatus: null, totalPrice: 20, vendorId: 3, vendorName: "V" },
  ]);
  const service = new InvoiceIssuesService({ findPendingShipmentOrders, load: jest.fn() });
  const result = await service.pendingShipments({ endDate: "2026-10-28T21:59:59.999Z", startDate: "2026-10-14T00:00:00.000Z" });
  expect(result.count).toBe(2);
  expect(result.orders.map((order) => order.shipmentStatusLabel)).toEqual(["معلقة", "بدون حالة"]);
  expect(result.truncated).toBe(false);
});
