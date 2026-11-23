import { QueryTypes, type Transaction } from "sequelize";

import { sequelize } from "../../infrastructure/database";
import { BILLABLE_ORDER_STATUSES } from "./invoice.eligibility";
import type { InvoiceStatus, LineState } from "./invoice.constants";
import type { AdjustmentRow, InvoiceRow, InvoiceTotals, LineRow, LineSnapshot } from "./invoice.types";

export type Tx = Transaction;

export type InvoiceListFilters = {
  billingDay?: number;
  dueParty?: "vendor" | "homix";
  invoiceCode?: string;
  invoiceFrom?: string;
  invoiceTo?: string;
  overdueOnly?: boolean;
  overdueDays: number;
  receipt?: "uploaded" | "missing";
  search?: string;
  statuses?: InvoiceStatus[];
  transferredFrom?: string;
  transferredTo?: string;
  vendorId?: number;
  page: number;
  size: number;
};

export type VendorBankRow = {
  bankName: string | null;
  bankAccountHolderName: string | null;
  bankAccountNumber: string | null;
  walletNumber: string | null;
  instaPayNumber: string | null;
};

export type InvoiceEventInput = {
  action: string;
  actorId: number;
  detail?: Record<string, unknown>;
  fromStatus?: string | null;
  invoiceId?: number | string | null;
  toStatus?: string | null;
  vendorId?: number | null;
};

const INVOICE_COLUMNS = `i.*, v.name AS "vendorName"`;
const LOCKING_LINE_STATES = ["included", "frozen", "removed"];

/** Columns that updateInvoiceFields may set — never interpolate anything else. */
const UPDATABLE_INVOICE_COLUMNS = new Set([
  "status", "code", "reviewedAt", "reviewedBy", "frozenAt", "frozenBy", "frozenDurationMs",
  "transferredAt", "transferredBy", "transferAmount",
  "receiptPath", "receiptName", "receiptMime", "receiptUploadedAt", "receiptUploadedBy",
]);

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export class InvoiceRepository {
  public transaction<T>(work: (transaction: Tx) => Promise<T>): Promise<T> {
    return sequelize.transaction(work);
  }

  public async findInvoice(id: number | string, transaction?: Tx, lock = false): Promise<InvoiceRow | null> {
    // FOR UPDATE cannot be combined with the vendor join's nullable side, so lock the invoice row only.
    const rows = await sequelize.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM financial_invoices i JOIN vendors v ON v.id = i."vendorId"
       WHERE i.id = :id ${lock ? "FOR UPDATE OF i" : ""}`,
      { replacements: { id }, transaction, type: QueryTypes.SELECT },
    );
    return rows[0] ?? null;
  }

  /** Inserts the draft or returns the already existing invoice for (vendor, cycle end). */
  public async upsertDraft(input: {
    billingDay: number; createdBy: number; periodEnd: string; periodStart: string; vendorId: number;
  }, transaction: Tx): Promise<{ created: boolean; invoice: InvoiceRow }> {
    const inserted = await sequelize.query<{ id: number }>(
      `INSERT INTO financial_invoices ("vendorId", "billingDay", "periodStart", "periodEnd", status, "createdBy")
       VALUES (:vendorId, :billingDay, :periodStart, :periodEnd, 'draft', :createdBy)
       ON CONFLICT ("vendorId", "periodEnd") DO NOTHING RETURNING id`,
      { replacements: input, transaction, type: QueryTypes.SELECT },
    );
    const id = inserted[0]?.id;
    if (id !== undefined) return { created: true, invoice: (await this.findInvoice(id, transaction, true))! };
    const existing = await sequelize.query<{ id: number }>(
      'SELECT id FROM financial_invoices WHERE "vendorId" = :vendorId AND "periodEnd" = :periodEnd',
      { replacements: input, transaction, type: QueryTypes.SELECT },
    );
    return { created: false, invoice: (await this.findInvoice(existing[0]!.id, transaction, true))! };
  }

  public listLines(invoiceId: number | string, transaction?: Tx): Promise<LineRow[]> {
    return sequelize.query<LineRow>(
      'SELECT * FROM financial_invoice_lines WHERE "invoiceId" = :invoiceId ORDER BY id',
      { replacements: { invoiceId }, transaction, type: QueryTypes.SELECT },
    );
  }

  public findLine(invoiceId: number | string, lineId: number | string, transaction: Tx): Promise<LineRow | undefined> {
    return sequelize.query<LineRow>(
      'SELECT * FROM financial_invoice_lines WHERE "invoiceId" = :invoiceId AND id = :lineId FOR UPDATE',
      { replacements: { invoiceId, lineId }, transaction, type: QueryTypes.SELECT },
    ).then((rows) => rows[0]);
  }

  public findLineByOrder(invoiceId: number | string, orderId: number | string, transaction: Tx): Promise<LineRow | undefined> {
    return sequelize.query<LineRow>(
      'SELECT * FROM financial_invoice_lines WHERE "invoiceId" = :invoiceId AND "orderId" = :orderId ORDER BY id LIMIT 1 FOR UPDATE',
      { replacements: { invoiceId, orderId }, transaction, type: QueryTypes.SELECT },
    ).then((rows) => rows[0]);
  }

  public listAdjustments(invoiceId: number | string, transaction?: Tx): Promise<AdjustmentRow[]> {
    return sequelize.query<AdjustmentRow>(
      'SELECT * FROM financial_invoice_adjustments WHERE "invoiceId" = :invoiceId ORDER BY id',
      { replacements: { invoiceId }, transaction, type: QueryTypes.SELECT },
    );
  }

  /** Orders that already sit on an active/frozen line or were permanently removed. */
  public async findLockedOrderIds(orderIds: number[], transaction: Tx): Promise<Set<number>> {
    if (orderIds.length === 0) return new Set();
    const rows = await sequelize.query<{ orderId: number }>(
      'SELECT "orderId" FROM financial_invoice_lines WHERE "orderId" IN (:orderIds) AND state IN (:states)',
      { replacements: { orderIds, states: LOCKING_LINE_STATES }, transaction, type: QueryTypes.SELECT },
    );
    return new Set(rows.map((row) => Number(row.orderId)));
  }

  /** Deferred lines of this vendor whose order is not on another active invoice. */
  public listPickableDeferred(vendorId: number, excludeInvoiceId: number | string, transaction: Tx): Promise<LineRow[]> {
    return sequelize.query<LineRow>(
      `SELECT l.* FROM financial_invoice_lines l
       JOIN financial_invoices i ON i.id = l."invoiceId"
       WHERE l.state = 'deferred' AND i."vendorId" = :vendorId AND l."invoiceId" <> :excludeInvoiceId
         AND NOT EXISTS (SELECT 1 FROM financial_invoice_lines a WHERE a."orderId" = l."orderId" AND a.state IN (:states))
       ORDER BY l.id`,
      { replacements: { excludeInvoiceId, states: LOCKING_LINE_STATES, vendorId }, transaction, type: QueryTypes.SELECT },
    );
  }

  /**
   * Inserts snapshot lines. The partial unique index makes the insert race-safe:
   * an order already active elsewhere is silently skipped. Returns inserted order ids.
   */
  public async insertLines(invoiceId: number | string, snapshots: LineSnapshot[], actorId: number, transaction: Tx): Promise<number[]> {
    const inserted: number[] = [];
    for (const snapshot of snapshots) {
      const rows = await sequelize.query<{ orderId: number }>(
        `INSERT INTO financial_invoice_lines
           ("invoiceId", "orderId", "operationNumber", "orderNumber", "productCode", "paymentStatus", "paymentStatusLabel",
            "isWarehouseDelivery", "collectionTotal", "warehouseCost", fines, "vendorShippingCost", "vendorDue", "companyDue", "companyDueKind",
            state, "stateChangedAt", "stateChangedBy")
         VALUES (:invoiceId, :orderId, :operationNumber, :orderNumber, :productCode, :paymentStatus, :paymentStatusLabel,
            :isWarehouseDelivery, :collectionTotal, :warehouseCost, :fines, :vendorShippingCost, :vendorDue, :companyDue, :companyDueKind,
            'included', NOW(), :actorId)
         ON CONFLICT ("orderId") WHERE state IN ('included', 'frozen', 'removed') DO NOTHING
         RETURNING "orderId"`,
        { replacements: { ...snapshot, actorId, invoiceId }, transaction, type: QueryTypes.SELECT },
      );
      if (rows[0]) inserted.push(Number(rows[0].orderId));
    }
    return inserted;
  }

  /** Refreshes ONLY the system-computed snapshot numbers of a line; overrides, reason and state are never touched. */
  public async refreshLineSnapshot(lineId: number | string, snapshot: LineSnapshot, transaction: Tx): Promise<void> {
    await sequelize.query(
      `UPDATE financial_invoice_lines SET "collectionTotal" = :collectionTotal, "warehouseCost" = :warehouseCost, fines = :fines,
         "vendorShippingCost" = :vendorShippingCost, "vendorDue" = :vendorDue, "companyDue" = :companyDue,
         "companyDueKind" = COALESCE(:companyDueKind, "companyDueKind") WHERE id = :lineId`,
      { replacements: { ...snapshot, lineId }, transaction, type: QueryTypes.UPDATE },
    );
  }

  public async setLineOverrides(
    lineId: number | string,
    values: {
      collectionOverride: number | null; companyDueOverride: number | null; finesOverride: number | null; overrideReason: string | null;
      vendorDueOverride: number | null; vendorShippingCostOverride: number | null; warehouseCostOverride: number | null;
    },
    transaction: Tx,
  ): Promise<void> {
    await sequelize.query(
      `UPDATE financial_invoice_lines SET "finesOverride" = :finesOverride, "vendorDueOverride" = :vendorDueOverride,
         "companyDueOverride" = :companyDueOverride, "overrideReason" = :overrideReason,
         "warehouseCostOverride" = :warehouseCostOverride, "collectionOverride" = :collectionOverride,
         "vendorShippingCostOverride" = :vendorShippingCostOverride WHERE id = :lineId`,
      { replacements: { ...values, lineId }, transaction, type: QueryTypes.UPDATE },
    );
  }

  public async setLineState(lineId: number | string, state: LineState, reason: string | null, actorId: number, transaction: Tx): Promise<void> {
    await sequelize.query(
      `UPDATE financial_invoice_lines SET state = :state, "stateReason" = :reason, "stateChangedAt" = NOW(), "stateChangedBy" = :actorId
       WHERE id = :lineId`,
      { replacements: { actorId, lineId, reason, state }, transaction, type: QueryTypes.UPDATE },
    );
  }

  public async insertAdjustment(
    invoiceId: number | string,
    input: { amount: number; kind: "addition" | "deduction"; label: string },
    actorId: number,
    transaction: Tx,
  ): Promise<AdjustmentRow> {
    const rows = await sequelize.query<AdjustmentRow>(
      `INSERT INTO financial_invoice_adjustments ("invoiceId", label, kind, amount, "createdBy")
       VALUES (:invoiceId, :label, :kind, :amount, :actorId) RETURNING *`,
      { replacements: { ...input, actorId, invoiceId }, transaction, type: QueryTypes.SELECT },
    );
    return rows[0]!;
  }

  public async removeAdjustment(invoiceId: number | string, adjustmentId: number | string, actorId: number, transaction: Tx): Promise<AdjustmentRow | undefined> {
    const rows = await sequelize.query<AdjustmentRow>(
      `UPDATE financial_invoice_adjustments SET "removedAt" = NOW(), "removedBy" = :actorId
       WHERE id = :adjustmentId AND "invoiceId" = :invoiceId AND "removedAt" IS NULL RETURNING *`,
      { replacements: { actorId, adjustmentId, invoiceId }, transaction, type: QueryTypes.SELECT },
    );
    return rows[0];
  }

  public async updateTotals(invoiceId: number | string, totals: InvoiceTotals, transaction: Tx): Promise<void> {
    await sequelize.query(
      `UPDATE financial_invoices SET "ordersCount" = :ordersCount, "collectionTotal" = :collectionTotal,
         "warehouseCost" = :warehouseCost, "vendorShippingCost" = :vendorShippingCost, "finesTotal" = :finesTotal,
         "vendorDueTotal" = :vendorDueTotal, "companyDueTotal" = :companyDueTotal,
         "adjustmentsTotal" = :adjustmentsTotal, "netAmount" = :netAmount, "updatedAt" = NOW()
       WHERE id = :invoiceId`,
      { replacements: { ...totals, invoiceId }, transaction, type: QueryTypes.UPDATE },
    );
  }

  public async updateInvoiceFields(invoiceId: number | string, fields: Record<string, unknown>, transaction: Tx): Promise<void> {
    const entries = Object.entries(fields);
    if (entries.some(([column]) => !UPDATABLE_INVOICE_COLUMNS.has(column))) {
      throw new Error("Unsupported invoice column");
    }
    const assignments = entries.map(([column]) => `"${column}" = :${column}`).join(", ");
    await sequelize.query(
      `UPDATE financial_invoices SET ${assignments ? `${assignments}, ` : ""}"updatedAt" = NOW() WHERE id = :invoiceId`,
      { replacements: { ...fields, invoiceId }, transaction, type: QueryTypes.UPDATE },
    );
  }

  public async nextInvoiceSequence(transaction: Tx): Promise<number> {
    const rows = await sequelize.query<{ value: string }>(
      "SELECT nextval('financial_invoice_code_seq') AS value",
      { transaction, type: QueryTypes.SELECT },
    );
    return Number(rows[0]!.value);
  }

  public async insertEvent(event: InvoiceEventInput, transaction: Tx): Promise<void> {
    await sequelize.query(
      `INSERT INTO financial_invoice_events ("invoiceId", "vendorId", action, "fromStatus", "toStatus", detail, "actorId")
       VALUES (:invoiceId, :vendorId, :action, :fromStatus, :toStatus, CAST(:detail AS jsonb), :actorId)`,
      {
        replacements: {
          action: event.action,
          actorId: event.actorId,
          detail: JSON.stringify(event.detail ?? {}),
          fromStatus: event.fromStatus ?? null,
          invoiceId: event.invoiceId ?? null,
          toStatus: event.toStatus ?? null,
          vendorId: event.vendorId ?? null,
        },
        transaction,
        type: QueryTypes.INSERT,
      },
    );
  }

  private buildInvoiceWhere(filters: InvoiceListFilters): { replacements: Record<string, unknown>; where: string } {
    const conditions: string[] = ["1 = 1"];
    const replacements: Record<string, unknown> = { overdueDays: filters.overdueDays };
    if (filters.statuses?.length) { conditions.push("i.status IN (:statuses)"); replacements.statuses = filters.statuses; }
    if (filters.vendorId) { conditions.push('i."vendorId" = :vendorId'); replacements.vendorId = filters.vendorId; }
    if (filters.billingDay) { conditions.push('i."billingDay" = :billingDay'); replacements.billingDay = filters.billingDay; }
    if (filters.invoiceFrom) { conditions.push('i."periodEnd" >= CAST(:invoiceFrom AS timestamptz)'); replacements.invoiceFrom = filters.invoiceFrom; }
    if (filters.invoiceTo) { conditions.push('i."periodEnd" <= CAST(:invoiceTo AS timestamptz)'); replacements.invoiceTo = filters.invoiceTo; }
    if (filters.transferredFrom) { conditions.push('i."transferredAt" >= CAST(:transferredFrom AS timestamptz)'); replacements.transferredFrom = filters.transferredFrom; }
    if (filters.transferredTo) { conditions.push('i."transferredAt" <= CAST(:transferredTo AS timestamptz)'); replacements.transferredTo = filters.transferredTo; }
    if (filters.dueParty === "vendor") conditions.push('i."netAmount" > 0');
    if (filters.dueParty === "homix") conditions.push('i."netAmount" < 0');
    if (filters.receipt === "uploaded") conditions.push('i."receiptPath" IS NOT NULL');
    if (filters.receipt === "missing") conditions.push('i."receiptPath" IS NULL');
    if (filters.invoiceCode) { conditions.push("i.code ILIKE :invoiceCode"); replacements.invoiceCode = `%${escapeLike(filters.invoiceCode)}%`; }
    if (filters.search) {
      conditions.push("(v.name ILIKE :search OR i.code ILIKE :search)");
      replacements.search = `%${escapeLike(filters.search)}%`;
    }
    if (filters.overdueOnly) {
      conditions.push(`i.status = 'reviewed' AND i."reviewedAt" IS NOT NULL
        AND (EXTRACT(EPOCH FROM (NOW() - i."reviewedAt")) * 1000 - i."frozenDurationMs") / 86400000 >= :overdueDays + 1`);
    }
    return { replacements, where: conditions.join(" AND ") };
  }

  public async listInvoices(filters: InvoiceListFilters): Promise<{ rows: InvoiceRow[]; total: number }> {
    const { replacements, where } = this.buildInvoiceWhere(filters);
    const rows = await sequelize.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM financial_invoices i JOIN vendors v ON v.id = i."vendorId"
       WHERE ${where} ORDER BY i."periodEnd" DESC, i.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit: filters.size, offset: (filters.page - 1) * filters.size }, type: QueryTypes.SELECT },
    );
    const counts = await sequelize.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM financial_invoices i JOIN vendors v ON v.id = i."vendorId" WHERE ${where}`,
      { replacements, type: QueryTypes.SELECT },
    );
    return { rows, total: Number(counts[0]?.total ?? 0) };
  }

  /** Invoices whose cycle ends inside [periodEndFrom, periodEndTo] (one cycle), optionally one vendor / some statuses. */
  public listCycleInvoices(filters: { periodEndFrom: string; periodEndTo: string; statuses?: InvoiceStatus[]; vendorId?: number }): Promise<InvoiceRow[]> {
    const conditions = ['i."periodEnd" >= CAST(:periodEndFrom AS timestamptz)', 'i."periodEnd" <= CAST(:periodEndTo AS timestamptz)'];
    const replacements: Record<string, unknown> = { periodEndFrom: filters.periodEndFrom, periodEndTo: filters.periodEndTo };
    if (filters.vendorId) { conditions.push('i."vendorId" = :vendorId'); replacements.vendorId = filters.vendorId; }
    if (filters.statuses?.length) { conditions.push("i.status IN (:statuses)"); replacements.statuses = filters.statuses; }
    return sequelize.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM financial_invoices i JOIN vendors v ON v.id = i."vendorId"
       WHERE ${conditions.join(" AND ")} ORDER BY i."vendorId", i.id`,
      { replacements, type: QueryTypes.SELECT },
    );
  }

  /**
   * Lines the live report cannot reproduce on its own: overridden amounts, lines that are not counted
   * (frozen/deferred/removed) and lines whose order falls outside the invoice's own cycle window
   * (deferred pick-ups, manually added orders).
   */
  public listCycleOverlayLines(invoiceIds: number[]): Promise<Array<LineRow & { outsideCycle: boolean; vendorId: number }>> {
    if (invoiceIds.length === 0) return Promise.resolve([]);
    return sequelize.query<LineRow & { outsideCycle: boolean; vendorId: number }>(
      `SELECT l.*, i."vendorId",
              (o.id IS NULL OR COALESCE(o."deliveryDate", o."updatedAt") < i."periodStart" OR COALESCE(o."deliveryDate", o."updatedAt") > i."periodEnd") AS "outsideCycle"
       FROM financial_invoice_lines l
       JOIN financial_invoices i ON i.id = l."invoiceId"
       LEFT JOIN orders o ON o.id = l."orderId"
       WHERE l."invoiceId" IN (:invoiceIds)
         AND (l."finesOverride" IS NOT NULL OR l."vendorDueOverride" IS NOT NULL OR l."companyDueOverride" IS NOT NULL
              OR l."warehouseCostOverride" IS NOT NULL OR l."collectionOverride" IS NOT NULL OR l."vendorShippingCostOverride" IS NOT NULL
              OR l.state <> 'included'
              OR o.id IS NULL OR COALESCE(o."deliveryDate", o."updatedAt") < i."periodStart" OR COALESCE(o."deliveryDate", o."updatedAt") > i."periodEnd")
       ORDER BY l.id`,
      { replacements: { invoiceIds }, type: QueryTypes.SELECT },
    );
  }

  /** Order ids that are counted (state = included) on each of the given invoices. */
  public listIncludedOrderIds(invoiceIds: number[]): Promise<Array<{ invoiceId: number | string; orderId: number }>> {
    if (invoiceIds.length === 0) return Promise.resolve([]);
    return sequelize.query<{ invoiceId: number | string; orderId: number }>(
      `SELECT "invoiceId", "orderId" FROM financial_invoice_lines WHERE "invoiceId" IN (:invoiceIds) AND state = 'included' ORDER BY id`,
      { replacements: { invoiceIds }, type: QueryTypes.SELECT },
    );
  }

  /** Every non-deleted vendor with a name (filter dropdown). */
  /**
   * Bank / wallet data of vendors' users (a vendor's own user rows, `users.vendorId`), keyed by vendor id.
   * Only rows with at least one non-empty bank field; an active user wins, then the oldest. Callers must gate exposure.
   */
  public async listVendorBanks(vendorIds: number[]): Promise<Map<number, VendorBankRow>> {
    const ids = [...new Set(vendorIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return new Map();
    const rows = await sequelize.query<VendorBankRow & { vendorId: number }>(
      `SELECT DISTINCT ON ("vendorId") "vendorId", "bankName", "bankAccountHolderName", "bankAccountNumber", "walletNumber", "instaPayNumber"
       FROM users
       WHERE "vendorId" IN (:ids) AND "deletedAt" IS NULL
         AND (COALESCE(TRIM("bankName"), '') <> '' OR COALESCE(TRIM("bankAccountHolderName"), '') <> '' OR COALESCE(TRIM("bankAccountNumber"), '') <> ''
              OR COALESCE(TRIM("walletNumber"), '') <> '' OR COALESCE(TRIM("instaPayNumber"), '') <> '')
       ORDER BY "vendorId", ("accountStatus" = 'active') DESC, id ASC`,
      { replacements: { ids }, type: QueryTypes.SELECT },
    );
    return new Map(rows.map((row) => [Number(row.vendorId), row]));
  }

  public listVendorOptions(): Promise<Array<{ id: number; name: string }>> {
    return sequelize.query<{ id: number; name: string }>(
      `SELECT id, name FROM vendors WHERE "deletedAt" IS NULL AND name IS NOT NULL AND TRIM(name) <> '' ORDER BY name, id`,
      { type: QueryTypes.SELECT },
    );
  }

  /** Counts per status for the tabs (vendor scoping applied by the caller through vendorId/statuses). */
  public async countByStatus(vendorId: number | undefined, statuses: InvoiceStatus[] | undefined): Promise<Record<string, number>> {
    const rows = await sequelize.query<{ status: string; total: string }>(
      `SELECT status, COUNT(*) AS total FROM financial_invoices
       WHERE (CAST(:vendorId AS integer) IS NULL OR "vendorId" = :vendorId)
         AND (CAST(:allStatuses AS boolean) OR status IN (:statuses))
       GROUP BY status`,
      { replacements: { allStatuses: !statuses, statuses: statuses ?? ["draft"], vendorId: vendorId ?? null }, type: QueryTypes.SELECT },
    );
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
  }

  /** Invoiced orders (included lines of non-draft invoices). */
  public async listInvoicedLines(filters: {
    invoiceCode?: string; operationNumber?: string; orderNumber?: string; page: number; productCode?: string; q?: string; size: number;
    statuses: InvoiceStatus[]; vendorIds?: number[];
  }): Promise<{ rows: Array<LineRow & { code: string | null; invoiceNetAmount?: string | number; invoiceStatus: InvoiceStatus; periodEnd: string; vendorId: number; vendorName: string; transferredAt: string | null; receiptPath: string | null }>; total: number }> {
    const replacements: Record<string, unknown> = { statuses: filters.statuses };
    const conditions = ["l.state = 'included'", "i.status IN (:statuses)"];
    if (filters.vendorIds?.length) { conditions.push('i."vendorId" IN (:vendorIds)'); replacements.vendorIds = filters.vendorIds; }
    const like = (column: string, key: string, value: string | undefined) => {
      if (!value) return;
      conditions.push(`${column} ILIKE :${key}`);
      replacements[key] = `%${escapeLike(value)}%`;
    };
    like('l."operationNumber"', "operationNumber", filters.operationNumber);
    like('l."orderNumber"', "orderNumber", filters.orderNumber);
    like('l."productCode"', "productCode", filters.productCode);
    like("i.code", "invoiceCode", filters.invoiceCode);
    if (filters.q) {
      conditions.push(`(l."operationNumber" ILIKE :q OR l."orderNumber" ILIKE :q OR l."productCode" ILIKE :q OR i.code ILIKE :q)`);
      replacements.q = `%${escapeLike(filters.q)}%`;
    }
    const where = conditions.join(" AND ");
    const rows = await sequelize.query<any>(
      `SELECT l.*, i.code, i.status AS "invoiceStatus", i."periodEnd", i."vendorId", v.name AS "vendorName",
              i."transferredAt", i."receiptPath", i."netAmount" AS "invoiceNetAmount"
       FROM financial_invoice_lines l JOIN financial_invoices i ON i.id = l."invoiceId" JOIN vendors v ON v.id = i."vendorId"
       WHERE ${where} ORDER BY i."periodEnd" DESC, l.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit: filters.size, offset: (filters.page - 1) * filters.size }, type: QueryTypes.SELECT },
    );
    const counts = await sequelize.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM financial_invoice_lines l JOIN financial_invoices i ON i.id = l."invoiceId" WHERE ${where}`,
      { replacements, type: QueryTypes.SELECT },
    );
    return { rows, total: Number(counts[0]?.total ?? 0) };
  }

  public async listEvents(filters: { invoiceId?: number; page: number; size: number }): Promise<{ rows: unknown[]; total: number }> {
    const replacements: Record<string, unknown> = {};
    let where = "1 = 1";
    if (filters.invoiceId) { where = 'e."invoiceId" = :invoiceId'; replacements.invoiceId = filters.invoiceId; }
    const rows = await sequelize.query(
      `SELECT e.id, e."invoiceId", e."vendorId", e.action, e."fromStatus", e."toStatus", e.detail, e."actorId", e."createdAt",
              NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), '') AS "actorName", i.code AS "invoiceCode", v.name AS "vendorName"
       FROM financial_invoice_events e
       LEFT JOIN users u ON u.id = e."actorId"
       LEFT JOIN financial_invoices i ON i.id = e."invoiceId"
       LEFT JOIN vendors v ON v.id = e."vendorId"
       WHERE ${where} ORDER BY e."createdAt" DESC, e.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit: filters.size, offset: (filters.page - 1) * filters.size }, type: QueryTypes.SELECT },
    );
    const counts = await sequelize.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM financial_invoice_events e WHERE ${where}`,
      { replacements, type: QueryTypes.SELECT },
    );
    return { rows, total: Number(counts[0]?.total ?? 0) };
  }

  public async transferredTotal(range: { from?: string; to?: string }): Promise<{ count: number; totalCents: number }> {
    const rows = await sequelize.query<{ count: string; total: string }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(ROUND(COALESCE("transferAmount", ABS("netAmount")) * 100)), 0) AS total
       FROM financial_invoices
       WHERE status = 'transferred'
         AND (CAST(:from AS timestamptz) IS NULL OR "transferredAt" >= CAST(:from AS timestamptz))
         AND (CAST(:to AS timestamptz) IS NULL OR "transferredAt" <= CAST(:to AS timestamptz))`,
      { replacements: { from: range.from ?? null, to: range.to ?? null }, type: QueryTypes.SELECT },
    );
    return { count: Number(rows[0]?.count ?? 0), totalCents: Number(rows[0]?.total ?? 0) };
  }

  /** Delivery date of an order in the report's own terms (coalesce(deliveryDate, updatedAt)). */
  public async findOrderForInvoicing(orderId: number, transaction: Tx): Promise<{ id: number; status: number; effectiveDeliveryDate: Date | string | null } | undefined> {
    const rows = await sequelize.query<{ id: number; status: number; effectiveDeliveryDate: Date | string | null }>(
      'SELECT id, status, COALESCE("deliveryDate", "updatedAt") AS "effectiveDeliveryDate" FROM orders WHERE id = :orderId AND "deletedAt" IS NULL',
      { replacements: { orderId }, transaction, type: QueryTypes.SELECT },
    );
    return rows[0];
  }

  public async searchOrderCandidates(vendorId: number, q: string): Promise<Array<{ id: number; code: string | null; orderNumber: string | null; status: number }>> {
    return sequelize.query(
      `SELECT DISTINCT o.id, o.code, o."orderNumber", o.status
       FROM orders o
       JOIN "orderLines" ol ON ol."orderId" = o.id AND ol."deletedAt" IS NULL
       JOIN products p ON p.id = ol."productId"
       WHERE o."deletedAt" IS NULL AND o.status IN (:billable) AND p."vendorId" = :vendorId
         AND (o.code ILIKE :q OR o."orderNumber"::text ILIKE :q)
         AND NOT EXISTS (SELECT 1 FROM financial_invoice_lines l WHERE l."orderId" = o.id AND l.state IN (:states))
       ORDER BY o.id DESC LIMIT 10`,
      {
        replacements: { billable: BILLABLE_ORDER_STATUSES, q: `%${escapeLike(q)}%`, states: LOCKING_LINE_STATES, vendorId },
        type: QueryTypes.SELECT,
      },
    );
  }
}
