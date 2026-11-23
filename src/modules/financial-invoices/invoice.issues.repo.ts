import moment from "moment-timezone";
import { QueryTypes } from "sequelize";

import { sequelize } from "../../infrastructure/database";
import type { IssueInvoice, IssueLine, LiveOrder } from "./invoice.issues";
import type { AdjustmentRow } from "./invoice.types";

const CAIRO = "Africa/Cairo";
/** Hard cap so a no-filter request cannot pull the whole ledger into memory; the response says when it was hit. */
export const ISSUES_MAX_INVOICES = 2000;
const CHUNK = 1000;

export type IssuesLoad = {
  adjustments: Array<Pick<AdjustmentRow, "invoiceId" | "kind" | "amount" | "removedAt">>;
  invoices: IssueInvoice[];
  lines: IssueLine[];
  orders: Map<number, LiveOrder>;
  scopeInvoiceIds: Set<number>;
  truncated: boolean;
};

const chunks = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK) out.push(items.slice(index, index + CHUNK));
  return out;
};

/** Read-only, indexed loads (invoice period/vendor indexes, line invoiceId/orderId indexes). */
export class InvoiceIssuesRepository {
  public async load(filters: { billingDay?: number; month?: string; vendorId?: number }): Promise<IssuesLoad> {
    // merged sources / cancelled consolidated invoices hold no lines of their own: they are not part of the errors check
    const conditions = ["i.status NOT IN ('consolidated', 'cancelled')"];
    const replacements: Record<string, unknown> = { cap: ISSUES_MAX_INVOICES + 1 };
    if (filters.vendorId) { conditions.push('i."vendorId" = :vendorId'); replacements.vendorId = filters.vendorId; }
    if (filters.billingDay) { conditions.push('i."billingDay" = :billingDay'); replacements.billingDay = filters.billingDay; }
    if (filters.month) {
      const start = moment.tz(filters.month, "YYYY-MM", CAIRO);
      replacements.from = start.clone().startOf("month").toISOString();
      replacements.to = start.clone().endOf("month").toISOString();
      conditions.push('i."periodEnd" >= CAST(:from AS timestamptz) AND i."periodEnd" <= CAST(:to AS timestamptz)');
    }
    const scoped = await sequelize.query<IssueInvoice>(
      `SELECT i.id, i.code, i."vendorId", i.status, i."periodEnd", i."netAmount", i."billingDay", v.name AS "vendorName"
       FROM financial_invoices i JOIN vendors v ON v.id = i."vendorId"
       WHERE ${conditions.join(" AND ")} ORDER BY i."periodEnd" DESC, i.id DESC LIMIT :cap`,
      { replacements, type: QueryTypes.SELECT },
    );
    const truncated = scoped.length > ISSUES_MAX_INVOICES;
    const invoices = scoped.slice(0, ISSUES_MAX_INVOICES);
    const scopeInvoiceIds = new Set(invoices.map((invoice) => Number(invoice.id)));
    const ids = [...scopeInvoiceIds];

    const lines: IssueLine[] = [];
    const adjustments: IssuesLoad["adjustments"] = [];
    for (const part of chunks(ids)) {
      lines.push(...await sequelize.query<IssueLine>(
        `SELECT id, "invoiceId", "orderId", "operationNumber", "orderNumber", state, "isWarehouseDelivery", "collectionTotal", "warehouseCost", fines,
                "vendorShippingCost", "vendorDue", "companyDue", "companyDueKind", "finesOverride", "vendorDueOverride", "companyDueOverride",
                "warehouseCostOverride", "collectionOverride", "vendorShippingCostOverride"
         FROM financial_invoice_lines WHERE "invoiceId" IN (:part)`,
        { replacements: { part }, type: QueryTypes.SELECT },
      ));
      adjustments.push(...await sequelize.query<IssuesLoad["adjustments"][number]>(
        `SELECT "invoiceId", kind, amount, "removedAt" FROM financial_invoice_adjustments WHERE "invoiceId" IN (:part) AND "removedAt" IS NULL`,
        { replacements: { part }, type: QueryTypes.SELECT },
      ));
    }

    // Counted lines of the same orders on invoices OUTSIDE the scope (other cycles / vendors); orderId is indexed.
    const orderIds = [...new Set(lines.filter((line) => line.state === "included" || line.state === "frozen").map((line) => Number(line.orderId)))];
    const known = new Set(lines.map((line) => Number(line.id)));
    const externalInvoiceIds = new Set<number>();
    for (const part of chunks(orderIds)) {
      const others = await sequelize.query<IssueLine>(
        `SELECT id, "invoiceId", "orderId", "operationNumber", "orderNumber", state, "isWarehouseDelivery", "collectionTotal", "warehouseCost", fines,
                "vendorShippingCost", "vendorDue", "companyDue", "companyDueKind"
         FROM financial_invoice_lines WHERE "orderId" IN (:part) AND state IN ('included', 'frozen')`,
        { replacements: { part }, type: QueryTypes.SELECT },
      );
      for (const other of others) {
        if (known.has(Number(other.id))) continue;
        known.add(Number(other.id));
        lines.push(other);
        if (!scopeInvoiceIds.has(Number(other.invoiceId))) externalInvoiceIds.add(Number(other.invoiceId));
      }
    }
    for (const part of chunks([...externalInvoiceIds])) {
      invoices.push(...await sequelize.query<IssueInvoice>(
        `SELECT i.id, i.code, i."vendorId", i.status, i."periodEnd", i."netAmount", i."billingDay", v.name AS "vendorName"
         FROM financial_invoices i JOIN vendors v ON v.id = i."vendorId" WHERE i.id IN (:part)`,
        { replacements: { part }, type: QueryTypes.SELECT },
      ));
    }

    const orders = new Map<number, LiveOrder>();
    for (const part of chunks(orderIds)) {
      const rows = await sequelize.query<LiveOrder & { id: number }>(
        `SELECT id, status, "deletedAt", "deliveryBy", "shipmentStatus" FROM orders WHERE id IN (:part)`,
        { replacements: { part }, type: QueryTypes.SELECT },
      );
      for (const row of rows) orders.set(Number(row.id), row);
    }
    return { adjustments, invoices, lines, orders, scopeInvoiceIds, truncated };
  }
}
