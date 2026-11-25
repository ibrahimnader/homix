import type { IssuesQuery, PendingShipmentsQuery } from "./invoice.issues.schemas";
import { detectInvoiceIssues, summarizeIssues } from "./invoice.issues";
import { SHIPMENT_STATUS_LABELS } from "../shipments/shipment.constants";
import { InvoiceIssuesRepository, PENDING_SHIPMENTS_MAX, type IssuesLoad, type PendingShipmentOrder } from "./invoice.issues.repo";

type Loader = {
  findPendingShipmentOrders?: (filters: PendingShipmentsQuery) => Promise<PendingShipmentOrder[]>;
  load: (filters: IssuesQuery) => Promise<IssuesLoad>;
};

export class InvoiceIssuesService {
  public constructor(private readonly repo: Loader = new InvoiceIssuesRepository()) {}

  public async find(query: IssuesQuery) {
    const loaded = await this.repo.load(query);
    const issues = detectInvoiceIssues(loaded);
    return { counts: summarizeIssues(issues), issues, scopedInvoices: loaded.scopeInvoiceIds.size, truncated: loaded.truncated };
  }

  /** Informational: Homix-delivered orders delivered per order status but not per shipment status. They are not billed until the shipment status is fixed. */
  public async pendingShipments(query: PendingShipmentsQuery) {
    const rows = await (this.repo.findPendingShipmentOrders ?? (() => Promise.resolve([])))(query);
    const orders = rows.map((row) => ({
      ...row,
      shipmentStatusLabel: row.shipmentStatus ? (SHIPMENT_STATUS_LABELS[Number(row.shipmentStatus)] ?? "") : "بدون حالة",
    }));
    return { count: orders.length, orders, truncated: orders.length >= PENDING_SHIPMENTS_MAX };
  }
}
