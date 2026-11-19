import { QueryTypes, type Transaction } from "sequelize";
import { USER_TYPES } from "../../../config/constants";
import { sequelize } from "../../infrastructure/database";
import { AppError } from "../../shared/errors";
import {
  buildRegressionAuditEntry, buildRegressionMessage, CONFIRM_REGRESSION_FIELD, findOrderRegressions, REGRESSION_AUDIT_ACTION,
  REGRESSION_FORBIDDEN_CODE, REGRESSION_NEEDS_CONFIRMATION_CODE, type OrderRegression,
} from "./order-regression-guard";

/**
 * Shared plumbing of the regression safety net for every writer that goes through the status sync
 * (order edit, shipment edit/bulk, returns, receipts, reassignment). The detection itself lives in
 * order-regression-guard; this file is the request/response side: flag parsing, 409/403, invoice lookup, audit rows.
 */

export type RegressionUser = { id?: number | string; userType?: string | number } | null | undefined;

export const isVendorRequestUser = (user: RegressionUser): boolean => String(user?.userType) === String(USER_TYPES.VENDOR);

/** true only for boolean true or the string "true"; vendors can never confirm. */
export const isRegressionConfirmed = (user: RegressionUser, ...flags: unknown[]): boolean =>
  !isVendorRequestUser(user) && flags.some((flag) => flag === true || flag === "true");

/** Removes `confirmRegression` from a payload so it never reaches a legacy writer; returns the clean payload and the raw flag. */
export const stripConfirmRegression = <T extends Record<string, unknown>>(payload: T | null | undefined): { payload: Omit<T, "confirmRegression">; flag: unknown } => {
  const { [CONFIRM_REGRESSION_FIELD]: flag, ...rest } = (payload ?? {}) as Record<string, unknown>;
  return { payload: rest as Omit<T, "confirmRegression">, flag };
};

/** Invoice statuses (reviewed / frozen / transferred) of the active financial-invoice lines each order sits on. */
export const lookupInvoiceLockedOrders = async (orderIds: number[], transaction?: Transaction): Promise<Map<number, string[]>> => {
  const result = new Map<number, string[]>();
  if (orderIds.length === 0) return result;
  const rows = await sequelize.query(
    `SELECT l."orderId" AS "orderId", i.status AS status
     FROM financial_invoice_lines l JOIN financial_invoices i ON i.id = l."invoiceId"
     WHERE l."orderId" IN (:orderIds) AND l.state IN ('included', 'frozen') AND i.status IN ('reviewed', 'frozen', 'transferred')`,
    { replacements: { orderIds }, type: QueryTypes.SELECT, ...(transaction ? { transaction } : {}) },
  ) as Array<{ orderId: number | string; status: string }>;
  for (const row of rows) {
    const key = Number(row.orderId);
    result.set(key, [...(result.get(key) ?? []), String(row.status)]);
  }
  return result;
};

/** 403 for vendors, 409 when the request did not confirm; otherwise returns the regressions to audit after the write. */
export const assertRegressionsAllowed = (regressions: OrderRegression[], confirmed: boolean, user: RegressionUser): OrderRegression[] => {
  if (regressions.length === 0) return [];
  const message = buildRegressionMessage(regressions);
  if (isVendorRequestUser(user)) throw new AppError(message, 403, REGRESSION_FORBIDDEN_CODE, { regressions });
  if (!confirmed) throw new AppError(message, 409, REGRESSION_NEEDS_CONFIRMATION_CODE, { regressions });
  return regressions;
};

/**
 * One call for the shipment-side writers: find the regressions of `payload` on each stored row, then allow/refuse.
 * Writers that set different statuses per row (reassignment) call findOrderRegressions per row and assertRegressionsAllowed once.
 */
export const guardRegressions = async (
  rows: ReadonlyArray<unknown>,
  payload: Record<string, unknown>,
  options: { confirmed: boolean; user: RegressionUser; lookupInvoices?: (ids: number[]) => Promise<Map<number, string[]>> },
): Promise<OrderRegression[]> => {
  const regressions = await findOrderRegressions(rows, payload, options.lookupInvoices ?? ((ids) => lookupInvoiceLockedOrders(ids)));
  return assertRegressionsAllowed(regressions, options.confirmed, options.user);
};

/** Audit rows for confirmed regressions (same shape as the order writer: action regression_confirmed, field regression). */
export const regressionAuditRows = (regressions: OrderRegression[], userId: number | string | null | undefined) =>
  regressions.map((regression) => ({
    action: REGRESSION_AUDIT_ACTION,
    entityId: regression.orderId,
    entityType: "order" as const,
    userId: Number(userId),
    ...buildRegressionAuditEntry(regression),
  }));
