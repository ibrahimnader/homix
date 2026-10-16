import express from "express";
import { QueryTypes } from "sequelize";
import { z } from "zod";
import { sequelize } from "../../infrastructure/database";
import { asyncHandler, validateRequest } from "../../shared/http";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";

const verifyToken = require("../../../app/middlewares/protectApi");
const isNotVendor = require("../../../app/middlewares/isNotVendor");
const requirePermission = require("../../../app/middlewares/requirePermission");

const ruleSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(2000).default(""),
  trigger: z.enum(["delivery_delay", "late_cancellation", "customer_refusal", "manual"]),
  amountType: z.enum(["fixed", "percent"]),
  amount: z.coerce.number().min(0),
  frequency: z.enum(["once", "daily"]),
  basis: z.enum(["subtotal", "total", "commission", "cost"]),
  graceHours: z.coerce.number().int().min(0),
  maxAmount: z.coerce.number().min(0).nullable(),
  effectiveFrom: z.string().datetime({ offset: true }),
  active: z.boolean(),
});
const idSchema = z.object({ id: z.coerce.number().int().positive() });
const logFilterSchema = z.object({
  ruleId: z.coerce.number().int().positive().optional(),
  orderId: z.coerce.number().int().positive().optional(),
  status: z.enum(["active", "waived"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const fineRouter = express.Router();
fineRouter.use(verifyToken, isNotVendor);

fineRouter.get("/rules", requirePermission("finance_view"), asyncHandler(async (_request, response) => {
  const rows = await sequelize.query('SELECT * FROM fine_rules ORDER BY "createdAt" DESC', { type: QueryTypes.SELECT });
  response.json({ status: true, data: rows });
}));

fineRouter.get("/summary", requirePermission("finance_view"), asyncHandler(async (_request, response) => {
  const [row] = await sequelize.query(`SELECT COUNT(*)::int AS "recordsCount",
    COALESCE(SUM(amount) FILTER (WHERE "waivedAt" IS NULL), 0)::numeric AS "activeAmount",
    COUNT(*) FILTER (WHERE "waivedAt" IS NOT NULL)::int AS "waivedCount" FROM fine_records`, { type: QueryTypes.SELECT });
  response.json({ status: true, data: row });
}));

fineRouter.post("/rules", requirePermission("finance_settle"), validateRequest({ body: ruleSchema }), asyncHandler(async (request, response) => {
  const [row] = await sequelize.query(`
    INSERT INTO fine_rules (name, description, trigger, "amountType", amount, frequency, basis, "graceHours", "maxAmount", "effectiveFrom", active)
    VALUES (:name, :description, :trigger, :amountType, :amount, :frequency, :basis, :graceHours, :maxAmount, :effectiveFrom, :active) RETURNING *
  `, { replacements: request.body, type: QueryTypes.SELECT });
  response.status(201).json({ status: true, data: row });
}));

fineRouter.put("/rules/:id", requirePermission("finance_settle"), validateRequest({ params: idSchema, body: ruleSchema }), asyncHandler(async (request, response) => {
  const [row] = await sequelize.query(`
    UPDATE fine_rules SET name = :name, description = :description, trigger = :trigger,
      "amountType" = :amountType, amount = :amount, frequency = :frequency, basis = :basis,
      "graceHours" = :graceHours, "maxAmount" = :maxAmount, "effectiveFrom" = :effectiveFrom,
      active = :active, "updatedAt" = NOW() WHERE id = :id RETURNING *
  `, { replacements: { ...request.body, id: request.params.id }, type: QueryTypes.SELECT });
  if (!row) throw new NotFoundError("Fine rule not found");
  response.json({ status: true, data: row });
}));

const listRecords = async (filters: z.infer<typeof logFilterSchema>, limit = true) => {
  const where = ["1=1"];
  if (filters.ruleId) where.push('r."ruleId" = :ruleId');
  if (filters.orderId) where.push('r."orderId" = :orderId');
  if (filters.status) where.push(filters.status === "waived" ? 'r."waivedAt" IS NOT NULL' : 'r."waivedAt" IS NULL');
  if (filters.from) where.push('r."appliedAt" >= :from');
  if (filters.to) where.push('r."appliedAt" < (CAST(:to AS date) + INTERVAL \'1 day\')');
  return sequelize.query(`SELECT r.*, f.name AS "ruleName", f.trigger, o."orderNumber"
    FROM fine_records r JOIN fine_rules f ON f.id = r."ruleId" JOIN orders o ON o.id = r."orderId"
    WHERE ${where.join(" AND ")} ORDER BY r."appliedAt" DESC ${limit ? "LIMIT 2000" : ""}`, {
    replacements: filters, type: QueryTypes.SELECT,
  });
};

fineRouter.get("/records", requirePermission("finance_view"), validateRequest({ query: logFilterSchema }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await listRecords(request.query as z.infer<typeof logFilterSchema>) });
}));

fineRouter.get("/records/export", requirePermission("finance_export"), validateRequest({ query: logFilterSchema }), asyncHandler(async (request, response) => {
  const rows = await listRecords(request.query as z.infer<typeof logFilterSchema>, false);
  const columns = ["id", "ruleName", "orderId", "orderNumber", "amount", "appliedAt", "waivedAt", "waiveReason"];
  const csv = [columns.join(","), ...rows.map((row: any) => columns.map((column) => `"${String(row[column] ?? "").replace(/"/g, '""')}"`).join(","))].join("\r\n");
  response.header("Content-Type", "text/csv; charset=utf-8");
  response.header("Content-Disposition", 'attachment; filename="fine-records.csv"');
  response.send(`\uFEFF${csv}`);
}));

fineRouter.post("/records/manual", requirePermission("finance_settle"), validateRequest({ body: z.object({ ruleId: z.coerce.number().int().positive(), orderId: z.coerce.number().int().positive() }) }), asyncHandler(async (request, response) => {
  const { ruleId, orderId } = request.body as { ruleId: number; orderId: number };
  const record = await sequelize.transaction(async (transaction) => {
    const [rule] = await sequelize.query<any>('SELECT * FROM fine_rules WHERE id = :ruleId AND active = TRUE', { replacements: { ruleId }, transaction, type: QueryTypes.SELECT });
    if (!rule) throw new NotFoundError("Active fine rule not found");
    if (rule.trigger !== "manual") throw new ValidationError("Only manual rules can be applied from this action");
    const [order] = await sequelize.query<any>('SELECT id, "subTotalPrice", "totalPrice", commission, "totalCost" FROM orders WHERE id = :orderId AND "deletedAt" IS NULL FOR UPDATE', { replacements: { orderId }, transaction, type: QueryTypes.SELECT });
    if (!order) throw new NotFoundError("Order not found");
    const [existing] = await sequelize.query<any>('SELECT id FROM fine_records WHERE "ruleId" = :ruleId AND "orderId" = :orderId', { replacements: { ruleId, orderId }, transaction, type: QueryTypes.SELECT });
    if (existing) throw new ConflictError("This rule has already been applied to this order");
    const basis = { subtotal: order.subTotalPrice, total: order.totalPrice, commission: order.commission, cost: order.totalCost }[rule.basis as "subtotal" | "total" | "commission" | "cost"];
    const unit = rule.amountType === "percent" ? (Number(basis) || 0) * Number(rule.amount) / 100 : Number(rule.amount);
    const amount = Math.round(Math.min(Math.max(unit, 0), rule.maxAmount == null ? Infinity : Number(rule.maxAmount)) * 100) / 100;
    if (amount <= 0) throw new ValidationError("Calculated fine must be greater than zero");
    const [inserted] = await sequelize.query('INSERT INTO fine_records ("ruleId", "orderId", amount) VALUES (:ruleId, :orderId, :amount) RETURNING *', { replacements: { ruleId, orderId, amount }, transaction, type: QueryTypes.SELECT });
    await sequelize.query('UPDATE orders SET fine = (SELECT COALESCE(SUM(amount), 0) FROM fine_records WHERE "orderId" = :orderId AND "waivedAt" IS NULL) WHERE id = :orderId', { replacements: { orderId }, transaction });
    return inserted;
  });
  response.status(201).json({ status: true, data: record });
}));

fineRouter.post("/records/:id/waive", requirePermission("finance_settle"), validateRequest({ params: idSchema, body: z.object({ reason: z.string().trim().min(3).max(1000) }) }), asyncHandler(async (request, response) => {
  const row = await sequelize.transaction(async (transaction) => {
    const [record] = await sequelize.query<any>(`UPDATE fine_records SET "waivedAt" = NOW(), "waiveReason" = :reason, "waivedBy" = :userId
      WHERE id = :id AND "waivedAt" IS NULL RETURNING *`, {
      replacements: { id: request.params.id, reason: request.body.reason, userId: Number((request as any).user?.id) || null }, transaction, type: QueryTypes.SELECT,
    });
    if (!record) throw new NotFoundError("Active fine record not found");
    await sequelize.query('UPDATE orders SET fine = (SELECT COALESCE(SUM(amount), 0) FROM fine_records WHERE "orderId" = :orderId AND "waivedAt" IS NULL) WHERE id = :orderId', { replacements: { orderId: record.orderId }, transaction });
    return record;
  });
  response.json({ status: true, data: row });
}));
