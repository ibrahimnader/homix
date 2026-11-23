import express, { type Request, type RequestHandler } from "express";

import { asyncHandler, validateRequest } from "../../shared/http";
import { ForbiddenError, ValidationError } from "../../shared/errors";
import { OrderRepository } from "../orders/order.repo";
import { RECEIPT_FOLDER } from "./invoice.constants";
import { InvoiceRepository } from "./invoice.repo";
import {
  activityQuery, addOrderBody, adjustmentBody, bulkTransitionBody, candidatesQuery, cycleQuery, generateBody, invoiceAdjustmentParams,
  invoiceIdParams, invoiceLineParams, invoiceListQuery, invoicedLinesQuery, lineActionBody, lineOverrideBody,
  reconciliationBody, reconciliationQuery, reviewLiveAllBody, reviewLiveBody, transitionBody,
} from "./invoice.schemas";
import { InvoiceService, type Scope } from "./invoice.service";

const requirePermission = require("../../../app/middlewares/requirePermission");
const fileUploadMiddleware = require("../../../config/fileUploadMiddleware");
const { USER_TYPES } = require("../../../config/constants");

const orderRepository = new OrderRepository();
export const invoiceService = new InvoiceService({
  getReport: (query, vendorId) => orderRepository.getFinancialReport(query, vendorId),
  repo: new InvoiceRepository(),
});

type AuthUser = { id: number; userType?: string; vendorId?: number | null };
const userOf = (request: Request): AuthUser => request.user as unknown as AuthUser;

/**
 * Read scope comes only from the authenticated user, never from query/body.
 * A vendor account without a vendorId is rejected instead of being treated as unscoped.
 */
export const scopeOf = (request: Request): Scope => {
  const user = userOf(request);
  if (user?.userType === USER_TYPES.VENDOR) {
    if (!user.vendorId) throw new ForbiddenError("Forbidden");
    return { vendorId: Number(user.vendorId) };
  }
  return {};
};

/** Mutations are staff-only. 403 (unlike the legacy isNotVendor, which answers 200). */
const staffOnly: RequestHandler = (request, _response, next) => {
  if (!userOf(request) || userOf(request).userType === USER_TYPES.VENDOR) {
    throw new ForbiddenError("Forbidden");
  }
  next();
};

const actorOf = (request: Request) => ({ id: Number(userOf(request).id) });
const view = requirePermission("finance_view");
const settle: RequestHandler[] = [staffOnly, requirePermission("finance_settle")];

export const invoiceRouter = express.Router();

/**
 * @swagger
 * /financial-invoices:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: List vendor invoices (archive table)
 *     description: Vendors only receive their own `reviewed`/`transferred` invoices regardless of the filters sent.
 *     parameters:
 *       - { in: query, name: status, schema: { type: string }, description: "Comma separated: draft,reviewed,frozen,transferred" }
 *       - { in: query, name: vendorId, schema: { type: integer } }
 *       - { in: query, name: billingDay, schema: { type: integer, enum: [13, 28] } }
 *       - { in: query, name: invoiceFrom, schema: { type: string, format: date }, description: Cycle end date from }
 *       - { in: query, name: invoiceTo, schema: { type: string, format: date } }
 *       - { in: query, name: transferredFrom, schema: { type: string, format: date } }
 *       - { in: query, name: transferredTo, schema: { type: string, format: date } }
 *       - { in: query, name: dueParty, schema: { type: string, enum: [vendor, homix] } }
 *       - { in: query, name: receipt, schema: { type: string, enum: [uploaded, missing] } }
 *       - { in: query, name: overdue, schema: { type: boolean } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: invoiceCode, schema: { type: string }, description: "partial, case-insensitive invoice code" }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: size, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ status, data: { items, counts, page, size, total } }" }
 */
invoiceRouter.get("/", view, validateRequest({ query: invoiceListQuery }), asyncHandler(async (request, response) => {
  const query = request.query as unknown as ReturnType<typeof invoiceListQuery.parse>;
  const { status, ...rest } = query;
  response.json({ status: true, data: await invoiceService.list({ ...rest, statuses: status }, scopeOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/vendors:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Vendor options for the invoice filters (staff only)
 *     responses:
 *       200: { description: "{ status, data: [{ id, name }] }" }
 */
invoiceRouter.get("/vendors", staffOnly, view, asyncHandler(async (_request, response) => {
  response.json({ status: true, data: await invoiceService.vendorOptions() });
}));

/**
 * @swagger
 * /financial-invoices/cycle:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Invoice status per vendor for one billing cycle + the overridden/uncounted lines (live report overlay)
 *     description: Vendors only receive their own reviewed/transferred invoices and counted lines regardless of the filters sent.
 *     parameters:
 *       - { in: query, name: periodEnd, required: true, schema: { type: string, format: date }, description: "Cairo day the cycle ends on (report cycle.endDate)" }
 *       - { in: query, name: vendorId, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ status, data: { invoices, lines, includedOrderIds } }" }
 */
invoiceRouter.get("/cycle", view, validateRequest({ query: cycleQuery }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.cycleOverview(request.query as never, scopeOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/lines:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Invoiced orders («الطلبات المفوترة») — counted lines of reviewed/frozen/transferred invoices
 *     parameters:
 *       - { in: query, name: q, schema: { type: string }, description: "combined search: operation / order / product code or invoice code" }
 *       - { in: query, name: operationNumber, schema: { type: string }, description: "partial, case-insensitive" }
 *       - { in: query, name: orderNumber, schema: { type: string }, description: "partial, case-insensitive" }
 *       - { in: query, name: productCode, schema: { type: string }, description: "partial, case-insensitive" }
 *       - { in: query, name: invoiceCode, schema: { type: string }, description: "partial, case-insensitive" }
 *       - { in: query, name: vendorId, schema: { type: string }, description: "vendor id or a comma separated list (ignored for vendor users, who only see their own)" }
 *     responses:
 *       200: { description: Paged invoiced order lines }
 */
invoiceRouter.get("/lines", view, validateRequest({ query: invoicedLinesQuery }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.invoicedLines(request.query as never, scopeOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/activity:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Audit log of every invoice state change (staff only)
 *     parameters:
 *       - { in: query, name: invoiceId, schema: { type: integer } }
 *     responses:
 *       200: { description: Paged events with actor name and timestamp }
 */
invoiceRouter.get("/activity", staffOnly, view, validateRequest({ query: activityQuery }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.activity(request.query as never) });
}));

/**
 * @swagger
 * /financial-invoices/reconciliation:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: System total of transferred invoices (for bank reconciliation)
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date }, description: transferredAt from }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ count, systemTotal }" }
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Record a bank statement total; returns the difference and logs it
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bankTotal]
 *             properties: { bankTotal: { type: number }, from: { type: string, format: date }, to: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ count, systemTotal, bankTotal, difference }" }
 */
invoiceRouter.get("/reconciliation", staffOnly, view, validateRequest({ query: reconciliationQuery }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.reconciliationSummary(request.query as never) });
}));
invoiceRouter.post("/reconciliation", ...settle, validateRequest({ body: reconciliationBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.recordReconciliation(request.body, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/generate:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Generate (or top up) draft invoices for a closed billing cycle from the live financial report
 *     description: Idempotent per (vendor, cycle). The open (current) cycle is allowed and creates drafts; review stays blocked until the cycle ends. Pass vendorId to create an invoice for a single vendor (even with no orders, e.g. to hold a manual adjustment).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [billingDay]
 *             properties:
 *               billingDay: { type: integer, enum: [13, 28] }
 *               referenceDate: { type: string, format: date }
 *               vendorId: { type: integer }
 *     responses:
 *       200: { description: Per-vendor result (created, added orders, skipped deferred) }
 *       409: { description: Cycle still open }
 */
invoiceRouter.post("/generate", ...settle, validateRequest({ body: generateBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.generate(request.body, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/review-live:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Review one vendor's live cycle in one step (create-or-reuse the draft, then draft -> reviewed)
 *     description: Staff only (finance_settle). One transaction. Existing manual overrides and line states are kept and orders already on another invoice are never duplicated. Idempotent - an invoice already reviewed/frozen/transferred is returned unchanged. 409 until the cycle end has passed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, billingDay]
 *             properties:
 *               vendorId: { type: integer }
 *               billingDay: { type: integer, enum: [13, 28] }
 *               referenceDate: { type: string, format: date }
 *     responses:
 *       200: { description: "{ cycle, vendorId, alreadyReviewed, invoice }" }
 *       403: { description: Vendor users or missing finance_settle }
 *       409: { description: Cycle still open, or empty invoice }
 */
invoiceRouter.post("/review-live", ...settle, validateRequest({ body: reviewLiveBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.reviewLive(request.body, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/review-live-all:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Review every vendor of the live cycle that has counted orders
 *     description: Staff only (finance_settle). Each vendor in its own transaction; failures are reported per vendor and do not abort the others. 409 while the cycle is still open.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [billingDay]
 *             properties:
 *               billingDay: { type: integer, enum: [13, 28] }
 *               referenceDate: { type: string, format: date }
 *     responses:
 *       200: { description: "{ cycle, results: [{ vendorId, ok, invoiceId?, alreadyReviewed?, error? }], succeeded, failed }" }
 *       409: { description: Cycle still open }
 */
invoiceRouter.post("/review-live-all", ...settle, validateRequest({ body: reviewLiveAllBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.reviewLiveAll(request.body, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/bulk-transition:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Apply a status transition to several invoices (each in its own transaction)
 *     description: "`to`: reviewed | frozen | transferred. Transfer uses the computed amount. Returns a per-id result; failures do not abort the others."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids, to]
 *             properties: { ids: { type: array, items: { type: integer } }, to: { type: string, enum: [reviewed, frozen, transferred] } }
 *     responses:
 *       200: { description: "{ results: [{ id, ok, error? }], succeeded }" }
 */
invoiceRouter.post("/bulk-transition", ...settle, validateRequest({ body: bulkTransitionBody }), asyncHandler(async (request, response) => {
  const { ids, to } = request.body as { ids: number[]; to: "reviewed" | "frozen" | "transferred" };
  response.json({ status: true, data: await invoiceService.bulkTransition(ids, to, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Invoice detail with lines and adjustments (vendors: own reviewed/transferred only, counted lines only)"
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ invoice, lines, adjustments }" }
 *       404: { description: "Not found (also returned for another vendor's invoice)" }
 */
invoiceRouter.get("/:id", view, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.detail(Number(request.params.id), scopeOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}/refresh:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Draft only — recompute the system numbers of the existing lines from the live report (overrides, states and adjustments are kept)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ refreshed, totals }" }
 *       409: { description: Invoice is not a draft }
 */
invoiceRouter.post("/:id/refresh", ...settle, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.refreshDraft(Number(request.params.id), actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}/sync:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Pull newly delivered orders of the cycle and deferred orders into a draft (existing lines untouched)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ added, skippedDeferred }" }
 *       409: { description: Invoice is not a draft }
 */
invoiceRouter.post("/:id/sync", ...settle, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.sync(Number(request.params.id), actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}/transition:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Change invoice status
 *     description: "Allowed: draft->reviewed, reviewed->draft, reviewed->frozen, frozen->reviewed, reviewed->transferred (optional transferAmount, default |net|), transferred->reviewed. Anything else is 409."
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to]
 *             properties: { to: { type: string, enum: [draft, reviewed, frozen, transferred] }, transferAmount: { type: number } }
 *     responses:
 *       200: { description: Updated invoice }
 *       409: { description: Transition not allowed }
 */
invoiceRouter.post("/:id/transition", ...settle, validateRequest({ params: invoiceIdParams, body: transitionBody }), asyncHandler(async (request, response) => {
  const { to, transferAmount } = request.body as { to: never; transferAmount?: number };
  if (transferAmount !== undefined && to !== "transferred") throw new ValidationError("transferAmount only applies to transfers");
  response.json({ status: true, data: await invoiceService.transition(Number(request.params.id), to, { transferAmount }, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}/adjustments:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Add a manual adjustment (draft only). deduction lowers the vendor payout, addition raises it.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label, kind, amount]
 *             properties: { label: { type: string }, kind: { type: string, enum: [addition, deduction] }, amount: { type: number } }
 *     responses:
 *       200: { description: "{ adjustment, netAmount }" }
 * /financial-invoices/{id}/adjustments/{adjustmentId}:
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Remove an adjustment (soft delete, audited; draft only)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: adjustmentId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ netAmount }" }
 */
invoiceRouter.post("/:id/adjustments", ...settle, validateRequest({ params: invoiceIdParams, body: adjustmentBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.addAdjustment(Number(request.params.id), request.body, actorOf(request)) });
}));
invoiceRouter.delete("/:id/adjustments/:adjustmentId", ...settle, validateRequest({ params: invoiceAdjustmentParams }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.removeAdjustment(Number(request.params.id), Number(request.params.adjustmentId), actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}/order-candidates:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Search delivered orders of the invoice's vendor that are not on any active invoice
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: query, name: q, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Up to 10 orders }
 * /financial-invoices/{id}/lines:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Add an order to a draft invoice (amounts come from the live report, then snapshotted)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [orderId], properties: { orderId: { type: integer } } }
 *     responses:
 *       200: { description: "{ netAmount }" }
 *       409: { description: "Order not delivered, not this vendor's, or already invoiced" }
 */
invoiceRouter.get("/:id/order-candidates", ...settle, validateRequest({ params: invoiceIdParams, query: candidatesQuery }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.orderCandidates(Number(request.params.id), (request.query as { q: string }).q) });
}));
invoiceRouter.post("/:id/lines", ...settle, validateRequest({ params: invoiceIdParams, body: addOrderBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.addOrder(Number(request.params.id), request.body.orderId, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}/lines/{lineId}:
 *   patch:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Set or clear per-order overrides (draft only). null clears an override.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: lineId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               finesOverride: { type: number, nullable: true }
 *               vendorDueOverride: { type: number, nullable: true }
 *               companyDueOverride: { type: number, nullable: true }
 *               warehouseCostOverride: { type: number, nullable: true }
 *               collectionOverride: { type: number, nullable: true }
 *               vendorShippingCostOverride: { type: number, nullable: true, description: "شحن البائع — replaces the system vendor shipping cost of this line (vendor deliveries); null clears it" }
 *               reason: { type: string }
 *     responses:
 *       200: { description: "{ line, netAmount }" }
 * /financial-invoices/{id}/lines/{lineId}/action:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Order menu: defer (move to next invoice), freeze, unfreeze, delete (permanent), restore"
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: lineId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties: { action: { type: string, enum: [defer, freeze, unfreeze, delete, restore] }, reason: { type: string } }
 *     responses:
 *       200: { description: "{ state, netAmount }" }
 */
invoiceRouter.patch("/:id/lines/:lineId", ...settle, validateRequest({ params: invoiceLineParams, body: lineOverrideBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.setOverrides(Number(request.params.id), Number(request.params.lineId), request.body, actorOf(request)) });
}));
invoiceRouter.post("/:id/lines/:lineId/action", ...settle, validateRequest({ params: invoiceLineParams, body: lineActionBody }), asyncHandler(async (request, response) => {
  const { action, reason } = request.body as { action: never; reason?: string };
  response.json({ status: true, data: await invoiceService.lineAction(Number(request.params.id), Number(request.params.lineId), action, reason, actorOf(request)) });
}));

/**
 * @swagger
 * /financial-invoices/{id}/receipt:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Upload/replace the transfer receipt (multipart field `files`; jpeg/png/gif/pdf, 16MB). Transferred invoices only.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, properties: { files: { type: string, format: binary } } }
 *     responses:
 *       200: { description: Updated }
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Download the receipt (vendors: own transferred invoices only)"
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The file }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Remove the receipt (audited)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Removed }
 */
invoiceRouter.post("/:id/receipt", ...settle, validateRequest({ params: invoiceIdParams }), fileUploadMiddleware(RECEIPT_FOLDER), asyncHandler(async (request, response) => {
  const path = request.filePaths?.[0];
  const name = request.fileNames?.[0];
  if (!path || !name) throw new ValidationError("الملف مطلوب");
  await invoiceService.setReceipt(Number(request.params.id), { name, path }, actorOf(request));
  response.json({ status: true });
}));
invoiceRouter.get("/:id/receipt", view, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  const file = await invoiceService.receiptFor(Number(request.params.id), scopeOf(request));
  response.setHeader("Content-Type", file.mime);
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  response.setHeader("Cache-Control", "private, no-store");
  response.sendFile(file.absolutePath, (error) => {
    if (error && !response.headersSent) response.status(404).json({ status: false, message: "الملف غير موجود" });
  });
}));
invoiceRouter.delete("/:id/receipt", ...settle, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  await invoiceService.removeReceipt(Number(request.params.id), actorOf(request));
  response.json({ status: true });
}));
