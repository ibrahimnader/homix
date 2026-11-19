import { isShipmentTimelineLog, SHIPMENT_TIMELINE_FIELDS } from "./shipment.timeline";

const log = (action: string, field: string) => ({ action, field });

describe("shipment timeline whitelist", () => {
  it.each([...SHIPMENT_TIMELINE_FIELDS])("keeps shipment field %s", (field) => {
    expect(isShipmentTimelineLog(log("update", field))).toBe(true);
  });

  it("keeps the receipt-cancel event", () => {
    expect(isShipmentTimelineLog(log("cancel_receipt", "warehouseReceivedBy"))).toBe(true);
  });

  it.each([
    ["create", "order_received"],
    ["notify", "order_received_notification"],
    ["delete", ""],
    ["update", "confirmationStatus"],
    ["update", "status"],
    ["update", "priority"],
    ["update", "manufactureStatus"],
    ["update", "notes"],
    ["update", "totalPrice"],
    ["update", "downPayment"],
    ["update", "governorate"],
    ["update", "vendorId"],
    ["update", "paymentStatus"],
  ])("drops order event %s/%s", (action, field) => {
    expect(isShipmentTimelineLog(log(action, field))).toBe(false);
  });

  it("hides auto_sync marker rows", () => {
    expect(isShipmentTimelineLog(log("auto_sync", "autoSync"))).toBe(false);
    expect(isShipmentTimelineLog(log("auto_sync", "shipmentStatus"))).toBe(false);
  });
});
