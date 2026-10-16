import express from "express";
import { QueryTypes } from "sequelize";
import { z } from "zod";
import { sequelize } from "../../infrastructure/database";
import { asyncHandler, validateRequest } from "../../shared/http";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import { SHIPMENT_STATUS } from "./shipment.constants";
import { keepsSourcePendingForReason, sameReassignmentItem } from "./reassignment.logic";

const { ORDER_STATUS } = require("../../../config/constants");
const requirePermission = require("../../../app/middlewares/requirePermission");

const mutation = z.object({
  sourceOrderId: z.coerce.number().int().positive(),
  targetOrderId: z.coerce.number().int().positive().optional(),
  targetOperationNumber: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(2).max(200),
  notes: z.string().trim().max(2000).optional().default(""),
}).refine((value) => Boolean(value.targetOrderId || value.targetOperationNumber), "Choose a target order");

type OrderRow = { id: number; status: number; shipmentStatus: number | null };
type LineRow = { orderId: number; productId: number; sku: string | null; quantity: number };

export const reassignmentRouter = express.Router();

reassignmentRouter.get("/", requirePermission("ship_view"), asyncHandler(async (_request, response) => {
  const rows = await sequelize.query(`
    SELECT r.*, source."orderNumber" AS "sourceOrderNumber", target."orderNumber" AS "targetOrderNumber"
    FROM shipment_reassignments r
    JOIN orders source ON source.id = r."sourceOrderId"
    JOIN orders target ON target.id = r."targetOrderId"
    ORDER BY r."createdAt" DESC LIMIT 500
  `, { type: QueryTypes.SELECT });
  response.json({ status: true, data: rows });
}));

reassignmentRouter.post("/", requirePermission("ship_edit"), validateRequest({ body: mutation }), asyncHandler(async (request, response) => {
  const input = request.body as z.infer<typeof mutation>;
  const keepOldPending = keepsSourcePendingForReason(input.reason);
  const createdBy = Number((request as any).user?.id) || null;
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
      SELECT id, status, "shipmentStatus" FROM orders
      WHERE id IN (:ids) AND "deletedAt" IS NULL ORDER BY id FOR UPDATE
    `, { replacements: { ids: [input.sourceOrderId, targetOrderId] }, transaction, type: QueryTypes.SELECT });
    if (orders.length !== 2) throw new NotFoundError("Source or target order not found");
    const source = orders.find((row) => row.id === input.sourceOrderId)!;
    const target = orders.find((row) => row.id === targetOrderId)!;
    if ([ORDER_STATUS.CANCELED, ORDER_STATUS.DELIVERED, ORDER_STATUS.REFUNDED].includes(Number(source.status))) {
      throw new ConflictError("Source order is already final");
    }
    if ([ORDER_STATUS.CANCELED, ORDER_STATUS.DELIVERED, ORDER_STATUS.REFUNDED].includes(Number(target.status))) {
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

    await sequelize.query(`UPDATE orders SET status = :status, "shipmentStatus" = :shipmentStatus, "updatedAt" = NOW() WHERE id = :id`, {
      replacements: { id: input.sourceOrderId, status: keepOldPending ? ORDER_STATUS.PENDING : ORDER_STATUS.CANCELED, shipmentStatus: keepOldPending ? SHIPMENT_STATUS.PENDING : SHIPMENT_STATUS.CANCELED }, transaction,
    });
    await sequelize.query(`UPDATE orders SET status = :status, "shipmentStatus" = :shipmentStatus, "updatedAt" = NOW() WHERE id = :id`, {
      replacements: { id: targetOrderId, status: ORDER_STATUS.IN_INVENTORY, shipmentStatus: SHIPMENT_STATUS.IN_WAREHOUSE }, transaction,
    });
    const [inserted] = await sequelize.query(`
      INSERT INTO shipment_reassignments ("sourceOrderId", "targetOrderId", reason, notes, "keepOldPending", "createdBy")
      VALUES (:sourceOrderId, :targetOrderId, :reason, :notes, :keepOldPending, :createdBy) RETURNING *
    `, { replacements: { sourceOrderId: input.sourceOrderId, targetOrderId, reason: input.reason, notes: input.notes, keepOldPending, createdBy }, transaction, type: QueryTypes.SELECT });
    return inserted;
  });
  response.status(201).json({ status: true, data: record });
}));
