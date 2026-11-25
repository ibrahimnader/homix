import { billableOrderSql, BILLABLE_SQL_REPLACEMENTS, isBillableOrder, notBillableReason } from "./invoice.eligibility";

describe("isBillableOrder (delivered items only)", () => {
  test.each([
    [{ deliveryBy: 1, shipmentStatus: 4, status: 5 }, true, null],
    [{ deliveryBy: 1, shipmentStatus: 1, status: 5 }, false, "shipment_not_delivered"],
    [{ deliveryBy: 1, shipmentStatus: null, status: 5 }, false, "shipment_not_delivered"],
    [{ deliveryBy: 1, shipmentStatus: undefined, status: 5 }, false, "shipment_not_delivered"],
    [{ deliveryBy: 1, shipmentStatus: 4, status: 4 }, false, "order_not_delivered"],
    [{ deliveryBy: 2, shipmentStatus: null, status: 5 }, true, null],
    [{ deliveryBy: 2, shipmentStatus: 1, status: 5 }, true, null],
    [{ deliveryBy: null, shipmentStatus: null, status: 5 }, true, null],
    [{ status: 5 }, true, null],
    [{ deliveryBy: 2, shipmentStatus: null, status: 6 }, false, "order_not_delivered"],
    [{ deliveryBy: "1", shipmentStatus: "4", status: "5" }, true, null],
  ])("%j -> %s", (order, billable, reason) => {
    expect(isBillableOrder(order)).toBe(billable);
    expect(notBillableReason(order)).toBe(reason);
  });

  test("SQL twin mirrors the rule and binds every parameter", () => {
    const sql = billableOrderSql("o");
    expect(sql).toContain("o.status IN (:billable)");
    expect(sql).toContain('o."deliveryBy" IS DISTINCT FROM :homixDeliveryBy');
    expect(sql).toContain('o."shipmentStatus" = :shipmentDelivered');
    expect(BILLABLE_SQL_REPLACEMENTS).toEqual({ billable: [5], homixDeliveryBy: 1, shipmentDelivered: 4 });
  });
});
