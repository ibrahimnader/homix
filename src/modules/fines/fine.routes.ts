import express from "express";
import { QueryTypes } from "sequelize";
import { z } from "zod";
import { sequelize } from "../../infrastructure/database";
import { asyncHandler, validateRequest } from "../../shared/http";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";

const verifyToken = require("../../../app/middlewares/protectApi");
const isNotVendor = require("../../../app/middlewares/isNotVendor");
const requirePermission = require("../../../app/middlewares/requirePermission");

const MAX_MONEY = 1_000_000_000;
const arabicNumber = (label: string) => z.coerce.number({ invalid_type_error: `${label}: من فضلك أدخل رقمًا صحيحًا`, required_error: `${label}: هذا الحقل مطلوب` });
/** "" / null / missing -> null so an empty cap field means "no cap" instead of silently becoming 0. */
const optionalCap = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  arabicNumber("الحد الأقصى").min(0, "الحد الأقصى لا يمكن أن يكون أقل من صفر").max(MAX_MONEY, "الحد الأقصى كبير جدًا، من فضلك أدخل قيمة أقل").nullable(),
);

export const ruleSchema = z.object({
  name: z.string({ required_error: "اسم القاعدة: هذا الحقل مطلوب", invalid_type_error: "اسم القاعدة: من فضلك أدخل نصًا" })
    .trim().min(2, "اسم القاعدة: من فضلك أدخل حرفين على الأقل").max(150, "اسم القاعدة: لا يزيد عن 150 حرفًا"),
  description: z.string({ invalid_type_error: "الوصف: من فضلك أدخل نصًا" }).trim().max(2000, "الوصف: لا يزيد عن 2000 حرف").nullish().transform((value) => value ?? ""),
  trigger: z.enum(["delivery_delay", "late_cancellation", "customer_refusal", "manual"], { errorMap: () => ({ message: "سبب تطبيق الغرامة: من فضلك اختر سببًا من القائمة" }) }),
  amountType: z.enum(["fixed", "percent"], { errorMap: () => ({ message: "طريقة الحساب: من فضلك اختر قيمة ثابتة أو نسبة" }) }),
  amount: arabicNumber("قيمة الغرامة").gt(0, "قيمة الغرامة: من فضلك أدخل قيمة أكبر من صفر").max(MAX_MONEY, "قيمة الغرامة كبيرة جدًا، من فضلك أدخل قيمة أقل"),
  frequency: z.enum(["once", "daily"], { errorMap: () => ({ message: "التكرار: من فضلك اختر مرة واحدة أو يوميًا" }) }),
  basis: z.enum(["subtotal", "total", "commission", "cost"], { errorMap: () => ({ message: "أساس الحساب: من فضلك اختر أساسًا من القائمة" }) }),
  graceHours: arabicNumber("فترة السماح").int("فترة السماح: من فضلك أدخل عددًا صحيحًا من الساعات").min(0, "فترة السماح لا يمكن أن تكون أقل من صفر").max(87_600, "فترة السماح كبيرة جدًا"),
  maxAmount: optionalCap,
  effectiveFrom: z.string({ required_error: "تاريخ السريان: هذا الحقل مطلوب", invalid_type_error: "تاريخ السريان غير صالح" }).datetime({ offset: true, message: "تاريخ السريان غير صالح، من فضلك اختر تاريخًا ووقتًا صحيحين" }),
  active: z.boolean({ required_error: "حالة التفعيل: هذا الحقل مطلوب", invalid_type_error: "حالة التفعيل غير صالحة" }),
}).superRefine((rule, context) => {
  if (rule.amountType === "percent" && rule.amount > 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "النسبة المئوية: من فضلك أدخل قيمة بين 0 و100" });
  }
});
const REQUIRED_ID = "المعرّف غير صالح";
const idSchema = z.object({ id: z.coerce.number({ invalid_type_error: REQUIRED_ID }).int(REQUIRED_ID).positive(REQUIRED_ID) });
const logFilterSchema = z.object({
  ruleId: z.coerce.number().int().positive().optional(),
  orderId: z.coerce.number().int().positive().optional(),
  status: z.enum(["active", "waived"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  vendor: z.string().trim().min(1).max(100).optional(),
  operationNumber: z.string().trim().min(1).max(50).optional(),
});
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const fineRouter = express.Router();
fineRouter.use(verifyToken, isNotVendor);

fineRouter.get("/rules", requirePermission("finance_view"), asyncHandler(async (_request, response) => {
  const rows = await sequelize.query('SELECT * FROM fine_rules WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC', { type: QueryTypes.SELECT });
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
      active = :active, "updatedAt" = NOW() WHERE id = :id AND "deletedAt" IS NULL RETURNING *
  `, { replacements: { ...request.body, id: request.params.id }, type: QueryTypes.SELECT });
  if (!row) throw new NotFoundError("القاعدة غير موجودة أو تم حذفها");
  response.json({ status: true, data: row });
}));

fineRouter.delete("/rules/:id", requirePermission("finance_settle"), validateRequest({ params: idSchema }), asyncHandler(async (request, response) => {
  const [row] = await sequelize.query<any>('UPDATE fine_rules SET "deletedAt" = NOW(), active = FALSE, "updatedAt" = NOW() WHERE id = :id AND "deletedAt" IS NULL RETURNING id', {
    replacements: { id: request.params.id }, type: QueryTypes.SELECT,
  });
  if (!row) throw new NotFoundError("القاعدة غير موجودة أو تم حذفها");
  response.json({ status: true, data: { id: row.id } });
}));

const listRecords = async (filters: z.infer<typeof logFilterSchema>, limit = true) => {
  const where = ["1=1"];
  if (filters.ruleId) where.push('r."ruleId" = :ruleId');
  if (filters.orderId) where.push('r."orderId" = :orderId');
  if (filters.status) where.push(filters.status === "waived" ? 'r."waivedAt" IS NOT NULL' : 'r."waivedAt" IS NULL');
  if (filters.from) where.push('r."appliedAt" >= :from');
  if (filters.to) where.push('r."appliedAt" < (CAST(:to AS date) + INTERVAL \'1 day\')');
  const replacements: Record<string, unknown> = { ...filters };
  if (filters.operationNumber) { where.push("o.code ILIKE :operationLike"); replacements.operationLike = `%${escapeLike(filters.operationNumber)}%`; }
  if (filters.vendor) {
    where.push(`EXISTS (SELECT 1 FROM "orderLines" vl JOIN products vp ON vp.id = vl."productId" JOIN vendors vv ON vv.id = vp."vendorId"
      WHERE vl."orderId" = o.id AND vl."deletedAt" IS NULL AND vv.name ILIKE :vendorLike)`);
    replacements.vendorLike = `%${escapeLike(filters.vendor)}%`;
  }
  return sequelize.query(`SELECT r.*, f.name AS "ruleName", f.trigger, o."orderNumber", o.code AS "operationNumber", o.status AS "orderStatus",
    (SELECT string_agg(DISTINCT v.name, '، ') FROM "orderLines" l JOIN products p ON p.id = l."productId" JOIN vendors v ON v.id = p."vendorId"
      WHERE l."orderId" = o.id AND l."deletedAt" IS NULL) AS "vendorName"
    FROM fine_records r JOIN fine_rules f ON f.id = r."ruleId" JOIN orders o ON o.id = r."orderId"
    WHERE ${where.join(" AND ")} ORDER BY r."appliedAt" DESC ${limit ? "LIMIT 2000" : ""}`, {
    replacements, type: QueryTypes.SELECT,
  });
};

/**
 * @swagger
 * /fines/records:
 *   get:
 *     summary: List fine records (max 2000), including rule name, operation number, order status and maker (vendor) name
 *     tags: [Fines]
 *     parameters:
 *       - { in: query, name: ruleId, schema: { type: integer } }
 *       - { in: query, name: orderId, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, waived] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: vendor, schema: { type: string }, description: Case-insensitive contains match on the maker (vendor) name of the order's products }
 *       - { in: query, name: operationNumber, schema: { type: string }, description: Case-insensitive contains match on the operation number (orders.code) }
 *     responses:
 *       200:
 *         description: Fine records. `/fines/records/export` accepts the same filters and returns CSV.
 * /fines/rules/{id}:
 *   delete:
 *     summary: Soft-delete a fine rule (requires finance_settle). Existing records keep the rule name; the rule is never applied again.
 *     tags: [Fines]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Rule not found or already deleted }
 */
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

const manualSchema = z.object({
  ruleId: z.coerce.number({ invalid_type_error: "من فضلك اختر القاعدة" }).int("من فضلك اختر القاعدة").positive("من فضلك اختر القاعدة"),
  orderId: z.coerce.number({ invalid_type_error: "رقم الطلب: من فضلك أدخل رقمًا صحيحًا" }).int("رقم الطلب: من فضلك أدخل رقمًا صحيحًا").positive("رقم الطلب: من فضلك أدخل رقمًا أكبر من صفر").optional(),
  operationNumber: z.string({ invalid_type_error: "رقم العملية: من فضلك أدخل نصًا" }).trim().min(1, "رقم العملية: هذا الحقل مطلوب").max(50, "رقم العملية: لا يزيد عن 50 حرفًا").optional(),
}).refine((body) => body.orderId !== undefined || body.operationNumber !== undefined, { path: ["operationNumber"], message: "رقم العملية: هذا الحقل مطلوب" });

fineRouter.post("/records/manual", requirePermission("finance_settle"), validateRequest({ body: manualSchema }), asyncHandler(async (request, response) => {
  const { ruleId, orderId, operationNumber } = request.body as z.infer<typeof manualSchema>;
  const record = await sequelize.transaction(async (transaction) => {
    const [rule] = await sequelize.query<any>('SELECT * FROM fine_rules WHERE id = :ruleId AND "deletedAt" IS NULL', { replacements: { ruleId }, transaction, type: QueryTypes.SELECT });
    if (!rule) throw new NotFoundError("القاعدة غير موجودة أو تم حذفها");
    if (!rule.active) throw new ConflictError("هذه القاعدة معطّلة، من فضلك فعّلها أولًا ثم أعد المحاولة");
    if (rule.trigger !== "manual") throw new ValidationError("يمكن تطبيق القواعد اليدوية فقط من هذا الإجراء");
    const orders = await sequelize.query<any>(`SELECT id, "subTotalPrice", "totalPrice", commission, "totalCost" FROM orders WHERE ${orderId ? "id = :orderId" : "code = :operationNumber"} AND "deletedAt" IS NULL ORDER BY id LIMIT 2 FOR UPDATE`, { replacements: orderId ? { orderId } : { operationNumber }, transaction, type: QueryTypes.SELECT });
    if (!orders.length) throw new NotFoundError("لا يوجد طلب بهذا الرقم، من فضلك راجع رقم العملية");
    if (orders.length > 1) throw new ConflictError("يوجد أكثر من طلب بنفس رقم العملية، من فضلك تواصل مع الدعم الفني");
    const [order] = orders;
    const [existing] = await sequelize.query<any>('SELECT id FROM fine_records WHERE "ruleId" = :ruleId AND "orderId" = :orderId', { replacements: { ruleId, orderId: order.id }, transaction, type: QueryTypes.SELECT });
    if (existing) throw new ConflictError("تم تطبيق هذه القاعدة على هذا الطلب من قبل");
    const basis = { subtotal: order.subTotalPrice, total: order.totalPrice, commission: order.commission, cost: order.totalCost }[rule.basis as "subtotal" | "total" | "commission" | "cost"];
    const unit = rule.amountType === "percent" ? (Number(basis) || 0) * Number(rule.amount) / 100 : Number(rule.amount);
    const amount = Math.round(Math.min(Math.max(unit, 0), rule.maxAmount == null ? Infinity : Number(rule.maxAmount)) * 100) / 100;
    if (amount <= 0) throw new ValidationError("قيمة الغرامة المحسوبة لهذا الطلب تساوي صفرًا، لذلك لم يتم تطبيقها");
    const [inserted] = await sequelize.query('INSERT INTO fine_records ("ruleId", "orderId", amount) VALUES (:ruleId, :orderId, :amount) RETURNING *', { replacements: { ruleId, orderId: order.id, amount }, transaction, type: QueryTypes.SELECT });
    await sequelize.query('UPDATE orders SET fine = (SELECT COALESCE(SUM(amount), 0) FROM fine_records WHERE "orderId" = :orderId AND "waivedAt" IS NULL) WHERE id = :orderId', { replacements: { orderId: order.id }, transaction });
    return inserted;
  });
  response.status(201).json({ status: true, data: record });
}));

fineRouter.post("/records/:id/waive", requirePermission("finance_settle"), validateRequest({ params: idSchema, body: z.object({ reason: z.string({ required_error: "سبب الإلغاء: هذا الحقل مطلوب", invalid_type_error: "سبب الإلغاء: من فضلك أدخل نصًا" }).trim().min(3, "سبب الإلغاء: من فضلك اكتب 3 أحرف على الأقل").max(1000, "سبب الإلغاء: لا يزيد عن 1000 حرف") }) }), asyncHandler(async (request, response) => {
  const row = await sequelize.transaction(async (transaction) => {
    const [record] = await sequelize.query<any>(`UPDATE fine_records SET "waivedAt" = NOW(), "waiveReason" = :reason, "waivedBy" = :userId
      WHERE id = :id AND "waivedAt" IS NULL RETURNING *`, {
      replacements: { id: request.params.id, reason: request.body.reason, userId: Number((request as any).user?.id) || null }, transaction, type: QueryTypes.SELECT,
    });
    if (!record) {
      const [existing] = await sequelize.query<any>('SELECT id FROM fine_records WHERE id = :id', { replacements: { id: request.params.id }, transaction, type: QueryTypes.SELECT });
      if (existing) throw new ConflictError("تم إلغاء هذه الغرامة من قبل");
      throw new NotFoundError("الغرامة غير موجودة");
    }
    await sequelize.query('UPDATE orders SET fine = (SELECT COALESCE(SUM(amount), 0) FROM fine_records WHERE "orderId" = :orderId AND "waivedAt" IS NULL) WHERE id = :orderId', { replacements: { orderId: record.orderId }, transaction });
    return record;
  });
  response.json({ status: true, data: row });
}));
