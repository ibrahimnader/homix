import express, { type Request, type RequestHandler } from "express";

import { asyncHandler, validateRequest } from "../../shared/http";
import { ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors";
import { OrderRepository } from "../orders/order.repo";
import { RECEIPT_FOLDER } from "./invoice.constants";
import { InvoiceRepository } from "./invoice.repo";
import {
  activityQuery, addOrderBody, adjustmentBody, bulkTransitionBody, candidatesQuery, consolidateBody, cycleQuery, generateBody, invoiceAdjustmentParams,
  invoiceIdParams, invoiceLineParams, invoiceReceiptParams, invoiceListQuery, invoicedLinesQuery, lineActionBody, lineOverrideBody, liveAddOrderBody, liveCandidatesQuery, liveDraftBody, liveLineActionBody,
  reconciliationBody, reconciliationQuery, reviewLiveAllBody, reviewLiveBody, transitionBody,
} from "./invoice.schemas";
import { InvoiceService, type Scope } from "./invoice.service";
import { canSettle } from "./invoice.access";
import { issuesQuery } from "./invoice.issues.schemas";
import { InvoiceIssuesService } from "./invoice.issues.service";

const requirePermission = require("../../../app/middlewares/requirePermission");
const fileUploadMiddleware = require("../../../config/fileUploadMiddleware");
const { USER_TYPES } = require("../../../config/constants");

const orderRepository = new OrderRepository();
export const invoiceService = new InvoiceService({
  getReport: (query, vendorId) => orderRepository.getFinancialReport(query, vendorId),
  repo: new InvoiceRepository(),
});

type AuthUser = { id: number; permissions?: Record<string, unknown> | null; userType?: string; vendorId?: number | null };
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
  return { canSettle: canSettle(user) };
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
 *       - { in: query, name: kind, schema: { type: string, enum: [standard, consolidated] }, description: "consolidated = only «فاتورة شاملة» invoices" }
 *       - { in: query, name: dueParty, description: "vendor = net > 0, homix = net < 0 (net 0 matches neither), both = no direction filter (default)", schema: { type: string, enum: [vendor, homix, both] } }
 *       - { in: query, name: month, schema: { type: string, example: "2026-10" }, description: "YYYY-MM, Cairo month of the cycle end (periodEnd)" }
 *       - { in: query, name: receipt, schema: { type: string, enum: [uploaded, missing] } }
 *       - { in: query, name: overdue, schema: { type: boolean } }
 *       - { in: query, name: search, schema: { type: string }, description: "partial, case-insensitive vendor name OR invoice code (LIKE wildcards escaped)" }
 *       - { in: query, name: invoiceCode, schema: { type: string }, description: "partial, case-insensitive invoice code" }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: size, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ status, data: { items, counts, filteredCounts, page, size, total } } - counts = all invoices per status, filteredCounts = per status under every filter except status/kind (archive statuses only), total = filtered set size" }
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
 * /financial-invoices/months:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Cairo months (YYYY-MM of the cycle end) that have archive invoices, newest first
 *     description: Vendors only count their own reviewed/transferred invoices.
 *     responses:
 *       200: { description: "{ status, data: [{ month, count }] }" }
 */
invoiceRouter.get("/months", view, asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.months(scopeOf(request)) });
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
 * /financial-invoices/issues:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "«أخطاء وتصحيحات» - automatic data review of saved invoices (duplicates, missing numbers, dues conflicts, changed orders, net drift)"
 *     description: Staff only (finance_settle); vendors get 403. Read-only. Duplicate checks also look at counted lines of the same orders outside the filter.
 *     parameters:
 *       - { in: query, name: month, schema: { type: string, example: "2026-10" }, description: "YYYY-MM of the invoice cycle end (Cairo)" }
 *       - { in: query, name: billingDay, schema: { type: integer, enum: [13, 28] } }
 *       - { in: query, name: vendorId, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ status, data: { counts: { errors, warnings, total }, issues, scopedInvoices, truncated } }" }
 *       403: { description: Vendor users or missing finance_settle }
 */
const issuesService = new InvoiceIssuesService();
invoiceRouter.get("/issues", ...settle, validateRequest({ query: issuesQuery }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await issuesService.find(request.query as never) });
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
 * /financial-invoices/live/ensure-draft:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Create-or-reuse the draft invoice of one vendor's live cycle and return its id
 *     description: Staff only (finance_settle). Idempotent and race-safe (one draft per vendor+cycle; concurrent calls converge). Existing lines/overrides are untouched and orders already on another invoice are never duplicated. A non-draft invoice is returned as is (its status tells the caller it is locked). Allowed while the cycle is still open.
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
 *       200: { description: "{ cycle, invoiceId, created, added, status, vendorId, skippedDeferred }" }
 *       403: { description: Vendor users or missing finance_settle }
 * /financial-invoices/live/line-action:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Live row order menu: freeze / unfreeze / defer (move to the next cycle) / delete / restore, creating the draft first"
 *     description: Staff only (finance_settle). One transaction - ensure the draft, then apply the same rules as /{id}/lines/{lineId}/action. 409 when the invoice is reviewed/frozen/transferred, the action does not fit the line state, or the order is not on this invoice.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, billingDay, orderId, action]
 *             properties:
 *               vendorId: { type: integer }
 *               billingDay: { type: integer, enum: [13, 28] }
 *               referenceDate: { type: string, format: date }
 *               orderId: { type: integer }
 *               action: { type: string, enum: [defer, freeze, unfreeze, delete, restore] }
 *               reason: { type: string }
 *     responses:
 *       200: { description: "{ state, netAmount, created, invoiceId }" }
 *       403: { description: Vendor users or missing finance_settle }
 *       409: { description: Invoice locked, action not allowed for the line state, or order not on the invoice }
 * /financial-invoices/live/lines:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Add an order to the vendor's live-cycle invoice, creating the draft first
 *     description: Staff only (finance_settle). One transaction. Idempotent for an order already counted on the invoice. 409 when the invoice is locked, or the order is delivered to another vendor / already on another invoice / permanently removed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, billingDay, orderId]
 *             properties:
 *               vendorId: { type: integer }
 *               billingDay: { type: integer, enum: [13, 28] }
 *               referenceDate: { type: string, format: date }
 *               orderId: { type: integer }
 *     responses:
 *       200: { description: "{ netAmount, created, invoiceId, alreadyIncluded }" }
 *       403: { description: Vendor users or missing finance_settle }
 *       409: { description: Invoice locked or order not addable }
 * /financial-invoices/live/order-candidates:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Order picker for «إضافة طلب» on a live vendor section (no invoice needed)
 *     parameters:
 *       - { in: query, name: vendorId, required: true, schema: { type: integer } }
 *       - { in: query, name: q, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Up to 10 delivered orders of the vendor not on any active invoice }
 */
invoiceRouter.post("/live/ensure-draft", ...settle, validateRequest({ body: liveDraftBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.ensureLiveDraft(request.body, actorOf(request)) });
}));
invoiceRouter.post("/live/line-action", ...settle, validateRequest({ body: liveLineActionBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.liveLineAction(request.body, actorOf(request)) });
}));
invoiceRouter.post("/live/lines", ...settle, validateRequest({ body: liveAddOrderBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.liveAddOrder(request.body, actorOf(request)) });
}));
invoiceRouter.get("/live/order-candidates", ...settle, validateRequest({ query: liveCandidatesQuery }), asyncHandler(async (request, response) => {
  const { q, vendorId } = request.query as unknown as { q: string; vendorId: number };
  response.json({ status: true, data: await invoiceService.liveOrderCandidates(vendorId, q) });
}));

/**
 * @swagger
 * /financial-invoices/consolidate:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Merge ≥ 2 open invoices of ONE vendor into a consolidated invoice («فاتورة شاملة») — staff with finance_settle only"
 *     description: >
 *       Sources must be `draft` or `reviewed`, standard (not already consolidated/merged) and without receipt/transfer data, else 409 with the Arabic reason.
 *       Lines and adjustments MOVE to the new draft (kind `consolidated`, code `<base>-ALL`, period = the latest source cycle) keeping
 *       `sourceInvoiceId`; the sources become `consolidated` (hidden from the archive lists and the errors check). Net = Σ vendor due − Σ Homix due − Σ fines + adjustments (signed).
 *       Runs in one transaction under row locks on all the sources. Audit: `invoice.consolidated`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [invoiceIds], properties: { invoiceIds: { type: array, minItems: 2, maxItems: 50, items: { type: integer } } } }
 *     responses:
 *       200: { description: "{ invoice, sources }" }
 *       403: { description: Vendor users are refused }
 *       409: { description: "Different vendors / ineligible invoice / already merged (Arabic reason)" }
 * /financial-invoices/{id}/unconsolidate:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Undo a consolidated invoice while it is draft/reviewed with no receipt/transfer (فك الدمج)"
 *     description: "Lines/adjustments go back to their source invoices, sources get their previous status, the consolidated invoice is cancelled (kept for audit). Audit: `invoice.unconsolidated`."
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ restored, cancelledId }" }
 *       409: { description: Not a live consolidated invoice, or already frozen/transferred/with receipt }
 */
invoiceRouter.post("/consolidate", ...settle, validateRequest({ body: consolidateBody }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.consolidate(request.body.invoiceIds, actorOf(request)) });
}));
invoiceRouter.post("/:id/unconsolidate", ...settle, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.unconsolidate(Number(request.params.id), actorOf(request)) });
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
 *       200: { description: "{ invoice, lines, adjustments, vendorBank? } - vendorBank { bankName, accountHolder, accountNumber, walletNumber, instaPayNumber } | null is present ONLY for finance_settle staff and for the vendor on his own invoice (omitted for other staff; another vendor gets 404). netAmount is signed: > 0 Homix owes the vendor (dueParty vendor), < 0 the vendor owes Homix (dueParty homix), 0 settled (dueParty null)." }
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
 * /financial-invoices/{id}/receipts:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "List the transfer receipts of an invoice in upload order (vendors: own transferred invoices only)"
 *     description: "A legacy single receipt that is not yet a row is returned first with id 0."
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ status, data: [{ id, name, mime, size, uploadedAt, uploadedBy? }] }" }
 *       403: { description: Vendor asking for a non-transferred invoice }
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Add transfer receipts (multipart field `files`, up to 10 per request, 20 per invoice; jpeg/png/gif/pdf, 16MB each). Transferred invoices only. finance_settle staff."
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, properties: { files: { type: array, items: { type: string, format: binary } } } }
 *     responses:
 *       200: { description: "{ status, data: { added, count } }" }
 *       400: { description: "No file / too many files / wrong file type (JSON, Arabic message)" }
 *       409: { description: "Invoice is not transferred, or the receipts limit is reached" }
 *       413: { description: File larger than 16MB }
 * /financial-invoices/{id}/receipts/{receiptId}:
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Download one receipt (vendors: own transferred invoices only); receiptId 0 = the first receipt"
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: receiptId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The file }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: Remove one receipt (soft delete + file, audited). Only while the invoice is transferred. finance_settle staff.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: receiptId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Removed }
 *       409: { description: Invoice is not transferred }
 * /financial-invoices/{id}/receipt:
 *   post:
 *     deprecated: true
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Deprecated alias of POST /{id}/receipts (adds, no longer replaces)"
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Added }
 *   get:
 *     deprecated: true
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Deprecated alias: downloads the FIRST receipt (vendors: own transferred invoices only)"
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The file }
 *   delete:
 *     deprecated: true
 *     security: [{ bearerAuth: [] }]
 *     tags: [FinancialInvoices]
 *     summary: "Deprecated alias: removes the FIRST receipt"
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Removed }
 */
const uploadReceipts = asyncHandler(async (request, response) => {
  const paths = request.filePaths ?? [];
  const names = request.fileNames ?? [];
  if (paths.length === 0) throw new ValidationError("الملف مطلوب");
  const files = paths.map((path, index) => ({ name: names[index] ?? "receipt", path }));
  // the middleware already stored the files: the service deletes them again if it refuses
  const result = await invoiceService.addReceipts(Number(request.params.id), files, actorOf(request));
  response.json({ status: true, data: result });
});
const sendReceipt = (receiptIdOf: (request: Request) => number | undefined): RequestHandler => asyncHandler(async (request, response) => {
  const file = await invoiceService.receiptFor(Number(request.params.id), scopeOf(request), receiptIdOf(request));
  response.setHeader("Content-Type", file.mime);
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  response.setHeader("Cache-Control", "private, no-store");
  response.sendFile(file.absolutePath, (error) => {
    if (error && !response.headersSent) response.status(404).json({ status: false, message: "الملف غير موجود" });
  });
});
const firstReceiptId = async (request: Request): Promise<number | undefined> => {
  const list = await invoiceService.listReceipts(Number(request.params.id), { canSettle: true });
  return list[0]?.id;
};

invoiceRouter.get("/:id/receipts", view, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  response.json({ status: true, data: await invoiceService.listReceipts(Number(request.params.id), scopeOf(request)) });
}));
invoiceRouter.post("/:id/receipts", ...settle, validateRequest({ params: invoiceIdParams }), fileUploadMiddleware(RECEIPT_FOLDER), uploadReceipts);
invoiceRouter.get("/:id/receipts/:receiptId", view, validateRequest({ params: invoiceReceiptParams }), sendReceipt((request) => Number(request.params.receiptId)));
invoiceRouter.delete("/:id/receipts/:receiptId", ...settle, validateRequest({ params: invoiceReceiptParams }), asyncHandler(async (request, response) => {
  await invoiceService.removeReceipt(Number(request.params.id), Number(request.params.receiptId), actorOf(request));
  response.json({ status: true });
}));
// legacy single-receipt endpoints (older frontends): add / first / remove-first
invoiceRouter.post("/:id/receipt", ...settle, validateRequest({ params: invoiceIdParams }), fileUploadMiddleware(RECEIPT_FOLDER), uploadReceipts);
invoiceRouter.get("/:id/receipt", view, validateRequest({ params: invoiceIdParams }), sendReceipt(() => undefined));
invoiceRouter.delete("/:id/receipt", ...settle, validateRequest({ params: invoiceIdParams }), asyncHandler(async (request, response) => {
  const first = await firstReceiptId(request);
  if (first === undefined) throw new NotFoundError("لا يوجد إيصال");
  await invoiceService.removeReceipt(Number(request.params.id), first, actorOf(request));
  response.json({ status: true });
}));
