import express from "express";
import { QueryTypes } from "sequelize";
import { z } from "zod";
import { sequelize } from "../../infrastructure/database";
import { asyncHandler, validateRequest } from "../../shared/http";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import { SHIPMENT_STATUS, SHIPMENT_STATUS_LABELS } from "./shipment.constants";
import { toDateRangeBoundary } from "./shipment.helpers";
import { buildAutoSyncLogRows, deriveStatusPatch } from "../orders/order-status-sync";
import {
  assertRegressionsAllowed, isRegressionConfirmed, lookupInvoiceLockedOrders, regressionAuditRows,
} from "../orders/order-regression-gate";
import { confirmRegressionSchema, findOrderRegressions } from "../orders/order-regression-guard";
import { notifyShipmentStatusChanges } from "./shipment.notifications";
import type { ShipmentStatusChange } from "./shipment.notifications";
import {
  keepsSourcePendingForReason, REASSIGNMENT_CANDIDATE_REASON_LABELS, reassignmentCandidateReason, sameReassignmentItem,
} from "./reassignment.logic";

const { ORDER_STATUS, CLOSED_ORDER_STATUSES } = require("../../../config/constants");
const requirePermission = require("../../../app/middlewares/requirePermission");

const mutation = z.object({
  sourceOrderId: z.coerce.number().int().positive(),
  targetOrderId: z.coerce.number().int().positive().optional(),
  targetOperationNumber: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(2).max(200),
  notes: z.string().trim().max(2000).optional().default(""),
  /** Confirms a reassignment that moves an invoiced order (reviewed/frozen/transferred invoice line) to an earlier state. */
  confirmRegression: confirmRegressionSchema.optional(),
}).refine((value) => Boolean(value.targetOrderId || value.targetOperationNumber), "Choose a target order");

const candidatesQuery = z.object({
  sourceOrderId: z.coerce.number().int().positive(),
  q: z.string().trim().min(1).max(100),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح");
const logQuery = z.object({
  oldOrder: z.string().trim().max(100).optional(),
  newOrder: z.string().trim().max(100).optional(),
  code: z.string().trim().max(100).optional(),
  vendorId: z.coerce.number().int().positive().optional(),
  dateFrom: day.optional(),
  dateTo: day.optional(),
});

type OrderRow = { id: number; orderNumber?: string | null; status: number; shipmentStatus: number | null; confirmationStatus: number | null; manufactureStatus: number | null; scheduleStatus: number | null };
type LineRow = { orderId: number; productId: number; sku: string | null; quantity: number };

export const reassignmentRouter = express.Router();

/**
 * @swagger
 * /shipments/reassignments:
 *   get:
 *     summary: Reassignment log (latest 500), with optional filters
 *     tags: [Shipments]
 *     parameters:
 *       - { in: query, name: oldOrder, schema: { type: string }, description: Source operation/order number (contains) }
 *       - { in: query, name: newOrder, schema: { type: string }, description: Target operation/order number (contains) }
 *       - { in: query, name: code, schema: { type: string }, description: Item SKU (contains) }
 *       - { in: query, name: vendorId, schema: { type: integer }, description: Seller (vendor of the item) }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Log rows with item (sku/title), seller, amount and the user who reassigned
 */
reassignmentRouter.get("/", requirePermission("ship_view"), validateRequest({ query: logQuery }), asyncHandler(async (request, response) => {
  const filters = request.query as unknown as z.infer<typeof logQuery>;
  const replacements: Record<string, unknown> = {};
  const clauses: string[] = [];
  const contains = (value: string | undefined, key: string, sql: string) => {
    if (!value) return;
    replacements[key] = `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    clauses.push(sql.replace(/:key/g, `:${key}`));
  };
  contains(filters.oldOrder, "oldOrder", `(source.code ILIKE :key OR source."orderNumber"::text ILIKE :key)`);
  contains(filters.newOrder, "newOrder", `(target.code ILIKE :key OR target."orderNumber"::text ILIKE :key)`);
  contains(filters.code, "code", `line.sku ILIKE :key`);
  if (filters.vendorId) { replacements.vendorId = filters.vendorId; clauses.push(`product."vendorId" = :vendorId`); }
  /* Cairo calendar days, inclusive on both ends (same helper as the shipments filters). */
  if (filters.dateFrom) { replacements.dateFrom = toDateRangeBoundary(filters.dateFrom, "start"); clauses.push(`r."createdAt" >= :dateFrom`); }
  if (filters.dateTo) { replacements.dateTo = toDateRangeBoundary(filters.dateTo, "end"); clauses.push(`r."createdAt" <= :dateTo`); }
  const rows = await sequelize.query(`
    SELECT r.*, source."orderNumber" AS "sourceOrderNumber", target."orderNumber" AS "targetOrderNumber",
      source.code AS "sourceOperationNumber", target.code AS "targetOperationNumber",
      line.sku AS sku, COALESCE(line.title, product.title) AS "itemTitle", vendor.name AS "sellerName",
      source."totalPrice" AS amount,
      NULLIF(TRIM(CONCAT(creator."firstName", ' ', creator."lastName")), '') AS "createdByName"
    FROM shipment_reassignments r
    JOIN orders source ON source.id = r."sourceOrderId"
    JOIN orders target ON target.id = r."targetOrderId"
    LEFT JOIN LATERAL (
      SELECT sku, title, "productId" FROM "orderLines"
      WHERE "orderId" = source.id AND "deletedAt" IS NULL ORDER BY id LIMIT 1
    ) line ON TRUE
    LEFT JOIN products product ON product.id = line."productId"
    LEFT JOIN vendors vendor ON vendor.id = product."vendorId"
    LEFT JOIN users creator ON creator.id = r."createdBy"
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY r."createdAt" DESC LIMIT 500
  `, { replacements, type: QueryTypes.SELECT });
  response.json({ status: true, data: rows });
}));

/**
 * @swagger
 * /shipments/reassignments/candidates:
 *   get:
 *     summary: Search target orders for a reassignment (by operation number or order number)
 *     tags: [Shipments]
 *     parameters:
 *       - { in: query, name: sourceOrderId, required: true, schema: { type: integer } }
 *       - { in: query, name: q, required: true, schema: { type: string }, description: Operation number (orders.code) or order number, prefix/contains match }
 *     responses:
 *       200:
 *         description: Up to 10 matches, eligible ones first. Each has `eligible` and, when false, `reason`/`reasonLabel`.
 */
reassignmentRouter.get("/candidates", requirePermission("ship_view"), validateRequest({ query: candidatesQuery }), asyncHandler(async (request, response) => {
  const { sourceOrderId, q } = request.query as unknown as z.infer<typeof candidatesQuery>;
  const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`);
  const final = [ORDER_STATUS.CANCELED, ORDER_STATUS.DELIVERED, ORDER_STATUS.REFUNDED, ...CLOSED_ORDER_STATUSES];
  const rows = await sequelize.query<{
    id: number; code: string | null; orderNumber: string | null; status: number; shipmentStatus: number | null; customerName: string | null;
  }>(`
    SELECT o.id, o.code, o."orderNumber", o.status, o."shipmentStatus",
      NULLIF(TRIM(CONCAT(c."firstName", ' ', c."lastName")), '') AS "customerName"
    FROM orders o LEFT JOIN customers c ON c.id = o."customerId"
    WHERE o."deletedAt" IS NULL AND o.id <> :sourceOrderId
      AND (o.code ILIKE :contains OR o."orderNumber"::text ILIKE :contains)
    ORDER BY (o.code ILIKE :prefix) DESC, (o.code = :exact) DESC, o.id DESC
    LIMIT 10
  `, { replacements: { sourceOrderId, exact: q, prefix: `${escaped}%`, contains: `%${escaped}%` }, type: QueryTypes.SELECT });
  const ids = rows.map((row) => row.id);
  const lines = ids.length ? await sequelize.query<LineRow>(`
    SELECT "orderId", "productId", sku, quantity FROM "orderLines"
    WHERE "orderId" IN (:ids) AND "deletedAt" IS NULL ORDER BY id
  `, { replacements: { ids: [sourceOrderId, ...ids] }, type: QueryTypes.SELECT }) : [];
  const sourceLines = ids.length ? lines.filter((line) => line.orderId === sourceOrderId) : [];
  const prior = ids.length ? await sequelize.query<{ id: number }>(`
    SELECT "sourceOrderId" AS id FROM shipment_reassignments WHERE "sourceOrderId" IN (:ids)
    UNION SELECT "targetOrderId" FROM shipment_reassignments WHERE "targetOrderId" IN (:ids)
  `, { replacements: { ids: [sourceOrderId, ...ids] }, type: QueryTypes.SELECT }) : [];
  const reassigned = new Set(prior.map((row) => Number(row.id)));
  const sourceAlreadyReassigned = reassigned.has(sourceOrderId);
  const data = rows.map((row) => {
    const targetLines = lines.filter((line) => line.orderId === row.id);
    const reason = reassignmentCandidateReason({
      targetIsFinal: final.includes(Number(row.status)),
      alreadyReassigned: sourceAlreadyReassigned || reassigned.has(row.id),
      sourceLines,
      targetLines,
    });
    const first = targetLines[0];
    return {
      id: row.id,
      operationNumber: row.code,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      shipmentStatusLabel: SHIPMENT_STATUS_LABELS[Number(row.shipmentStatus)] ?? "",
      sku: first?.sku ?? null,
      quantity: targetLines.length === 1 ? Number(first!.quantity) : null,
      eligible: reason === null,
      reason,
      reasonLabel: reason ? REASSIGNMENT_CANDIDATE_REASON_LABELS[reason] : null,
    };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible));
  response.json({ status: true, data });
}));

/**
 * @swagger
 * /shipments/reassignments:
 *   post:
 *     summary: Reassign a shipment from a source order to a target order (source -> pending/canceled, target -> in inventory)
 *     tags: [Shipments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceOrderId, reason]
 *             properties:
 *               sourceOrderId: { type: integer }
 *               targetOrderId: { type: integer }
 *               targetOperationNumber: { type: string, description: Alternative to targetOrderId }
 *               reason: { type: string }
 *               notes: { type: string }
 *               confirmRegression: { type: boolean, description: "true confirms a reassignment that moves an invoiced order (reviewed/frozen/transferred invoice line) backwards; ignored for vendors" }
 *     responses:
 *       201: { description: Reassignment created }
 *       409:
 *         description: REGRESSION_NEEDS_CONFIRMATION (or another conflict) - resend with confirmRegression true; nothing was written
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderRegressionConflictResponse'
 *       403:
 *         description: REGRESSION_FORBIDDEN - vendors can never confirm a regression
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderRegressionConflictResponse'
 */
reassignmentRouter.post("/", requirePermission("ship_edit"), validateRequest({ body: mutation }), asyncHandler(async (request, response) => {
  const input = request.body as z.infer<typeof mutation>;
  const keepOldPending = keepsSourcePendingForReason(input.reason);
  const requestUser = (request as any).user;
  const createdBy = Number(requestUser?.id) || null;
  const statusChanges: ShipmentStatusChange[] = [];
  const record = await sequelize.transaction(async (transaction) => {
    let targetOrderId = input.targetOrderId;
    if (input.targetOperationNumber) {
      const matches = await sequelize.query<{ id: number }>(
        'SELECT id FROM orders WHERE code = :code AND "deletedAt" IS NULL ORDER BY id LIMIT 2',
        { replacements: { code: input.targetOperationNumber }, transaction, type: QueryTypes.SELECT },
      );
      if (matches.length !== 1) throw new NotFoundError("رقم العملية الجديدة غير موجود أو غير فريد");
      targetOrderId = matches[0]!.id;
    }
    if (targetOrderId === input.sourceOrderId) throw new ValidationError("اختر طلبًا مختلفًا");
    const orders = await sequelize.query<OrderRow>(`
      SELECT id, "orderNumber", status, "shipmentStatus", "confirmationStatus", "manufactureStatus", "scheduleStatus" FROM orders
      WHERE id IN (:ids) AND "deletedAt" IS NULL ORDER BY id FOR UPDATE
    `, { replacements: { ids: [input.sourceOrderId, targetOrderId] }, transaction, type: QueryTypes.SELECT });
    if (orders.length !== 2) throw new NotFoundError("Source or target order not found");
    const source = orders.find((row) => row.id === input.sourceOrderId)!;
    const target = orders.find((row) => row.id === targetOrderId)!;
    if ([ORDER_STATUS.CANCELED, ORDER_STATUS.DELIVERED, ORDER_STATUS.REFUNDED, ...CLOSED_ORDER_STATUSES].includes(Number(source.status))) {
      throw new ConflictError("Source order is already final");
    }
    if ([ORDER_STATUS.CANCELED, ORDER_STATUS.DELIVERED, ORDER_STATUS.REFUNDED, ...CLOSED_ORDER_STATUSES].includes(Number(target.status))) {
      throw new ConflictError("Target order is already final");
    }
    const prior = await sequelize.query(`
      SELECT id FROM shipment_reassignments WHERE "sourceOrderId" IN (:ids) OR "targetOrderId" IN (:ids) LIMIT 1
    `, { replacements: { ids: [input.sourceOrderId, targetOrderId] }, transaction, type: QueryTypes.SELECT });
    if (prior.length) throw new ConflictError("One of these orders has already been reassigned");

    const lines = await sequelize.query<LineRow>(`
      SELECT "orderId", "productId", sku, quantity FROM "orderLines"
      WHERE "orderId" IN (:ids) AND "deletedAt" IS NULL ORDER BY id
    `, { replacements: { ids: [input.sourceOrderId, targetOrderId] }, transaction, type: QueryTypes.SELECT });
    const oldLines = lines.filter((line) => line.orderId === input.sourceOrderId);
    const newLines = lines.filter((line) => line.orderId === targetOrderId);
    if (!sameReassignmentItem(oldLines, newLines)) {
      throw new ValidationError("Product, SKU and quantity must match");
    }

    /* Regression safety net, before the first write: the source goes back to pending / canceled and the target to in-inventory.
       Both are non-final here, so what can refuse the request is an order sitting on a reviewed / frozen / transferred invoice
       line. 409 asks for confirmRegression; vendors always get 403. Throwing here rolls the (still empty) transaction back. */
    const sourceStatuses = { status: keepOldPending ? ORDER_STATUS.PENDING : ORDER_STATUS.CANCELED, shipmentStatus: keepOldPending ? SHIPMENT_STATUS.PENDING : SHIPMENT_STATUS.CANCELED };
    const targetStatuses = { status: ORDER_STATUS.IN_INVENTORY, shipmentStatus: SHIPMENT_STATUS.IN_WAREHOUSE };
    const lookupInvoices = (ids: number[]) => lookupInvoiceLockedOrders(ids, transaction);
    const regressions = [
      ...await findOrderRegressions([source], sourceStatuses, lookupInvoices),
      ...await findOrderRegressions([target], targetStatuses, lookupInvoices),
    ];
    const confirmedRegressions = assertRegressionsAllowed(regressions, isRegressionConfirmed(requestUser, input.confirmRegression), requestUser);
    if (confirmedRegressions.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      await require("../../../app/modules/logs/log.model").bulkCreate(regressionAuditRows(confirmedRegressions, createdBy), { transaction });
    }

    /* The reassignment's own rules pick status + shipmentStatus explicitly; the
       shared status sync then fills the third linked column (confirmation) when
       the new order status implies one — it never overrides these explicit values. */
    const applyStatuses = async (row: OrderRow, status: number, shipmentStatus: number) => {
      const { patch, derived } = deriveStatusPatch(row as unknown as Record<string, unknown>, { status, shipmentStatus });
      const confirmationStatus = patch.confirmationStatus ?? row.confirmationStatus;
      const manufactureStatus = patch.manufactureStatus ?? row.manufactureStatus;
      const scheduleStatus = patch.scheduleStatus ?? row.scheduleStatus;
      await sequelize.query(`UPDATE orders SET status = :status, "shipmentStatus" = :shipmentStatus, "confirmationStatus" = :confirmationStatus, "manufactureStatus" = :manufactureStatus, "scheduleStatus" = :scheduleStatus, "updatedAt" = NOW() WHERE id = :id`, {
        replacements: { id: row.id, status, shipmentStatus, confirmationStatus, manufactureStatus, scheduleStatus }, transaction,
      });
      statusChanges.push({ fromStatus: row.shipmentStatus, orderId: row.id, toStatus: shipmentStatus });
      if (derived.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Log = require("../../../app/modules/logs/log.model");
        await Log.bulkCreate(buildAutoSyncLogRows(row.id, derived, createdBy), { transaction });
      }
    };
    await applyStatuses(source, sourceStatuses.status, sourceStatuses.shipmentStatus);
    await applyStatuses(target, targetStatuses.status, targetStatuses.shipmentStatus);
    const [inserted] = await sequelize.query(`
      INSERT INTO shipment_reassignments ("sourceOrderId", "targetOrderId", reason, notes, "keepOldPending", "createdBy")
      VALUES (:sourceOrderId, :targetOrderId, :reason, :notes, :keepOldPending, :createdBy) RETURNING *
    `, { replacements: { sourceOrderId: input.sourceOrderId, targetOrderId, reason: input.reason, notes: input.notes, keepOldPending, createdBy }, transaction, type: QueryTypes.SELECT });
    return inserted;
  });
  /* After the commit. The two orders end in different statuses, so they are notified as two separate changes
     (each text names its own shipment and status) - not aggregated. */
  for (const change of statusChanges) {
    await notifyShipmentStatusChanges([change], createdBy);
  }
  response.status(201).json({ status: true, data: record });
}));
