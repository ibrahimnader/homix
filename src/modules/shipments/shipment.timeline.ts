/**
 * Shipment timeline («سجل الأحداث» in the shipment details).
 *
 * Every edit is logged in the `logs` table against the ORDER id with entityType "order" — shipment
 * edits have no entityType of their own — so shipment events are told apart by an explicit WHITELIST.
 * Reassignments and returns live in their own tables (shipment_reassignments, shipment returns) and
 * only leave the derived status `update` rows in `logs`; shipment notes are a separate notes table.
 *
 * Kept: shipment status, schedule status/date, carrier, delivery dates, shipment type, delivery-by,
 * shipping fees, inventory-shipping flag and the warehouse receipt / receipt-cancel fields.
 * Dropped: order creation/notification/delete, confirmation/order/manufacture/payment status,
 * priority, customer data, order notes, other financial fields, and the `auto_sync` marker rows.
 */
export const SHIPMENT_TIMELINE_FIELDS: ReadonlySet<string> = new Set([
  "shipmentStatus",
  "scheduleStatus",
  "scheduledDeliveryDate",
  "shippingCompany",
  "deliveryDate",
  "shippingReceiveDate",
  "shipmentType",
  "deliveryBy",
  "shippingFees",
  "shippedFromInventory",
  "warehouseReceivedBy",
  "warehouseSenderName",
  "warehouseReceiptNotes",
  "warehouseReceiptNumber",
  "warehouseReceiptIssuedAt",
]);

/** Actions that are never shipment events regardless of field (order lifecycle + status-link markers). */
const EXCLUDED_ACTIONS: ReadonlySet<string> = new Set(["create", "notify", "delete", "auto_sync", "regression_confirmed"]);

export const isShipmentTimelineLog = (log: { action?: unknown; field?: unknown }): boolean => {
  const action = typeof log.action === "string" ? log.action : "";
  const field = typeof log.field === "string" ? log.field : "";
  return !EXCLUDED_ACTIONS.has(action) && SHIPMENT_TIMELINE_FIELDS.has(field);
};
