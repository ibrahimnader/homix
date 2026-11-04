/**
 * Single place that decides which orders may be invoiced. The per-vendor
 * computation itself is the live financial report (OrderRepository.getFinancialReport),
 * which currently counts orders with status DELIVERED. If billable statuses change
 * (another agent is adding order statuses), this is the only file to touch.
 */
const { ORDER_STATUS } = require("../../../config/constants");

export const BILLABLE_ORDER_STATUSES: number[] = [ORDER_STATUS.DELIVERED];

export const isBillableOrderStatus = (status: unknown): boolean =>
  BILLABLE_ORDER_STATUSES.includes(Number(status));
