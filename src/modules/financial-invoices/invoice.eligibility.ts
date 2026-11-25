/**
 * Single place that decides which orders may be invoiced («ONLY DELIVERED items»).
 * An order is billable only when its order status is DELIVERED and, for Homix deliveries (deliveryBy = HOMIX),
 * its shipment status is DELIVERED as well. Vendor-delivered orders have no shipment lifecycle in Homix
 * (shipmentStatus is mostly NULL), so the order status alone decides for them.
 * The live report (OrderRepository.getFinancialReport) applies the same rule; repo SQL reuses billableOrderSql().
 */
const { DELIVERY_BY, ORDER_STATUS } = require("../../../config/constants");

export const BILLABLE_ORDER_STATUSES: number[] = [ORDER_STATUS.DELIVERED];
export const HOMIX_DELIVERY_BY: number = DELIVERY_BY.HOMIX;
export const SHIPMENT_DELIVERED_STATUS = 4;

export type BillableOrderInput = { deliveryBy?: unknown; shipmentStatus?: unknown; status?: unknown };
export type NotBillableReason = "order_not_delivered" | "shipment_not_delivered";

export const isBillableOrderStatus = (status: unknown): boolean =>
  BILLABLE_ORDER_STATUSES.includes(Number(status));

/** Homix delivered the order itself, so its shipment lifecycle applies. */
export const isHomixDelivery = (deliveryBy: unknown): boolean =>
  deliveryBy !== null && deliveryBy !== undefined && Number(deliveryBy) === HOMIX_DELIVERY_BY;

export const notBillableReason = (order: BillableOrderInput): NotBillableReason | null => {
  if (!isBillableOrderStatus(order.status)) return "order_not_delivered";
  if (isHomixDelivery(order.deliveryBy) && Number(order.shipmentStatus) !== SHIPMENT_DELIVERED_STATUS) return "shipment_not_delivered";
  return null;
};

export const isBillableOrder = (order: BillableOrderInput): boolean => notBillableReason(order) === null;

/** Replacements the fragment below needs (merge into the query's own replacements). */
export const BILLABLE_SQL_REPLACEMENTS = {
  billable: BILLABLE_ORDER_STATUSES,
  homixDeliveryBy: HOMIX_DELIVERY_BY,
  shipmentDelivered: SHIPMENT_DELIVERED_STATUS,
};

/** SQL twin of isBillableOrder for an `orders` row aliased `alias` (NULL deliveryBy = not a Homix delivery). */
export const billableOrderSql = (alias = "o"): string =>
  `(${alias}.status IN (:billable) AND (${alias}."deliveryBy" IS DISTINCT FROM :homixDeliveryBy OR ${alias}."shipmentStatus" = :shipmentDelivered))`;
