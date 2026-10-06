import express from "express";

import { asyncHandler, validateRequest } from "../../shared/http";
import { OrderController } from "./order.controller";
import { OrderRepository } from "./order.repo";
import {
  orderBulkDeleteSchema,
  orderBulkUpdateSchema,
  orderExportQuerySchema,
  orderFinancialReportQuerySchema,
  orderIdParamsSchema,
  orderListQuerySchema,
  orderMutationSchema,
  orderNoteParamsSchema,
  orderNoteSchema,
  orderSellerChatMessageSchema,
  orderSellerChatParamsSchema,
  orderSummaryQuerySchema,
  sellerChatQuickRepliesSchema,
} from "./order.schemas";
import { OrderService } from "./order.service";

const verifyToken = require("../../../app/middlewares/protectApi");
const isNotVendor = require("../../../app/middlewares/isNotVendor");
const requirePermission = require("../../../app/middlewares/requirePermission");
const fileUploadMiddleware = require("../../../config/fileUploadMiddleware");

const orderRepository = new OrderRepository();
const orderService = new OrderService(orderRepository);
const orderController = new OrderController(orderService);
import { handleShopifyOrderWebhook } from "./order.webhook";

export const orderRouter = express.Router();

/**
 * @swagger
 * /orders/meta:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Get order filter metadata
 *     description: Returns the dropdown/filter options used by the orders page. This endpoint has no query parameters. Labels are returned in Arabic for statuses, manufacture statuses, payment statuses, priorities, order sources, and delivery-by options.
 *     responses:
 *       200:
 *         description: Order filter options
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderMetaResponse'
 *             examples:
 *               default:
 *                 summary: Orders filter metadata
 *                 value:
 *                   status: true
 *                   data:
 *                     assignees:
 *                       - id: 1
 *                         label: Sara Mohamed
 *                     manufactureStatuses:
 *                       - id: 1
 *                         label: مقبول
 *                       - id: 2
 *                         label: قيد التصنيع
 *                     paymentStatuses:
 *                       - id: 1
 *                         label: الدفع عند الاستلام
 *                       - id: 2
 *                         label: مدفوع
 *                     priorities:
 *                       - id: onSchedule
 *                         label: بالمدة
 *                       - id: almostDue
 *                         label: مستعجل
 *                       - id: urgent
 *                         label: مستعجل جدا
 *                     statuses:
 *                       - id: 1
 *                         label: معلق
 *                       - id: 2
 *                         label: قيد التصنيع
 *                     vendors:
 *                       - id: 3
 *                         label: ركنة للأثاث
 */
orderRouter.get("/meta", verifyToken, requirePermission("orders_view"), asyncHandler(orderController.getMeta));

/**
 * @swagger
 * /orders/summary:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Get order summary cards for the orders page
 *     parameters:
 *       - in: query
 *         name: orderNumber
 *         schema: { type: string }
 *       - in: query
 *         name: operationCode
 *         schema: { type: string }
 *       - in: query
 *         name: customerName
 *         schema: { type: string }
 *       - in: query
 *         name: productCode
 *         schema: { type: string }
 *       - in: query
 *         name: vendorName
 *         schema: { type: string }
 *       - in: query
 *         name: vendorId
 *         schema: { type: string, example: "3,4" }
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: manufactureStatus
 *         schema: { type: string, example: "2,3" }
 *       - in: query
 *         name: paymentStatus
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: deliveryBy
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: orderSource
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: userId
 *         schema: { type: integer }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           example: "3,2"
 *       - in: query
 *         name: deliveryStatus
 *         schema: { type: string, example: "1,2" }
 *     responses:
 *       200:
 *         description: Order summary cards
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderSummaryResponse'
 */
orderRouter.get(
  "/summary",
  verifyToken,
  requirePermission("orders_view"),
  validateRequest({ query: orderSummaryQuerySchema }),
  asyncHandler(orderController.getSummary),
);

/**
 * @swagger
 * /orders:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Create an order
 *     description: Creates an order through the current legacy-compatible order creation pipeline.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer, line_items]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "#H9802"
 *               number:
 *                 oneOf:
 *                   - type: integer
 *                   - type: string
 *                 example: "9802"
 *               order_number:
 *                 oneOf:
 *                   - type: integer
 *                   - type: string
 *                 example: "31667"
 *               customer:
 *                 type: object
 *                 description: Legacy customer payload used by the manual order creation/import pipeline.
 *               line_items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [title, price, quantity, variant_id]
 *                   properties:
 *                     title:
 *                       type: string
 *                       example: كنبة شيب
 *                     price:
 *                       type: number
 *                       example: 16999
 *                     quantity:
 *                       type: integer
 *                       example: 1
 *                     variant_id:
 *                       oneOf:
 *                         - type: integer
 *                         - type: string
 *                       example: 445566
 *               orderDate:
 *                 type: string
 *                 format: date-time
 *               paymentStatus:
 *                 type: integer
 *                 example: 1
 *               deliveryBy:
 *                 type: integer
 *                 example: 1
 *               orderSource:
 *                 type: integer
 *                 example: 1
 *               priority:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: Manual priority. `1` = بالمدة, `2` = مستعجل, `3` = مستعجل جدا.
 *                 example: 1
 *               expectedDeliveryDate:
 *                 type: string
 *                 format: date-time
 *               downPayment:
 *                 type: number
 *                 example: 200
 *               shippingFees:
 *                 type: number
 *                 example: 65
 *               toBeCollected:
 *                 type: number
 *                 example: 29998
 *             example:
 *               name: "#H9802"
 *               number: "9802"
 *               order_number: "31667"
 *               customer:
 *                 first_name: عبير
 *                 last_name: ابوالمجيد
 *                 phone: "01155559646"
 *               line_items:
 *                 - title: كنبة شيب
 *                   price: 16999
 *                   quantity: 1
 *                   variant_id: 445566
 *               orderDate: 2026-06-18T00:00:00.000Z
 *               paymentStatus: 1
 *               deliveryBy: 1
 *               orderSource: 1
 *               expectedDeliveryDate: 2026-06-20T00:00:00.000Z
 *               downPayment: 200
 *               shippingFees: 65
 *               toBeCollected: 29998
 *     responses:
 *       200:
 *         description: Order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *       400:
 *         description: Invalid order payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @swagger
 * /orders/webhook:
 *   post:
 *     tags: [Orders]
 *     summary: Shopify orders webhook (HMAC-authenticated, no bearer token)
 *     description: >
 *       Authenticated by the X-Shopify-Hmac-Sha256 header over the raw body.
 *       Shopify cannot send a bearer token, so this route sits outside verifyToken.
 *     responses:
 *       200:
 *         description: Order stored
 *       401:
 *         description: Missing or invalid signature
 *       422:
 *         description: Payload is not a storable order
 *       500:
 *         description: Storing failed — Shopify should retry
 */
// Deliberately no verifyToken: Shopify authenticates with an HMAC signature.
orderRouter.post("/webhook", asyncHandler(handleShopifyOrderWebhook));

orderRouter.post("/", verifyToken, requirePermission("orders_create"), validateRequest({ body: orderMutationSchema }), asyncHandler(orderController.createOrder));

/**
 * @swagger
 * /orders/financialReport:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Get invoice-based financial reports
 *     description: Returns the split financial invoice for delivered vendor orders and delivered warehouse shipments. By default the endpoint resolves the latest closed billing cycle in Cairo time. When `billingDay=13|28` is provided, the endpoint resolves that cycle within the reference month in Cairo time. You can also pass both `startDate` and `endDate` for a custom range based on `deliveryDate`.
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema:
 *           oneOf:
 *             - type: integer
 *             - type: string
 *         description: Optional vendor override for admin requests.
 *       - in: query
 *         name: billingDay
 *         schema:
 *           type: integer
 *           enum: [13, 28]
 *         description: Billing cycle closing day. `13` resolves the cycle from day 29 of the previous cycle month until day 13. `28` resolves the cycle from day 14 until day 28.
 *       - in: query
 *         name: referenceDate
 *         schema: { type: string, format: date }
 *         description: Optional reference date used to resolve the requested `billingDay` cycle within that month.
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *         description: Optional custom range start on `deliveryDate`. Must be paired with `endDate`.
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *         description: Optional custom range end on `deliveryDate`. Must be paired with `startDate`.
 *     responses:
 *       200:
 *         description: Financial report data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderFinancialReportResponse'
 */
orderRouter.get(
  "/financialReport",
  verifyToken,
  requirePermission("finance_view"),
  validateRequest({ query: orderFinancialReportQuerySchema }),
  asyncHandler(orderController.financialReport),
);

/**
 * @swagger
 * /orders/financialReport/export:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Export invoice-based financial report to Excel
 *     description: Downloads the same split financial invoice data as `/orders/financialReport` in Excel format.
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema:
 *           oneOf:
 *             - type: integer
 *             - type: string
 *       - in: query
 *         name: billingDay
 *         schema: { type: integer, enum: [13, 28] }
 *       - in: query
 *         name: referenceDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
orderRouter.get(
  "/financialReport/export",
  verifyToken,
  requirePermission("finance_export"),
  validateRequest({ query: orderFinancialReportQuerySchema }),
  asyncHandler(orderController.exportFinancialReport),
);

/**
 * @swagger
 * /orders/export:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Export orders to Excel
 *     description: Downloads an Excel export using the provided order filters.
 *     parameters:
 *       - in: query
 *         name: orderNumber
 *         schema: { type: string }
 *       - in: query
 *         name: operationCode
 *         schema: { type: string }
 *       - in: query
 *         name: customerName
 *         schema: { type: string }
 *       - in: query
 *         name: productCode
 *         schema: { type: string }
 *       - in: query
 *         name: vendorName
 *         schema: { type: string }
 *       - in: query
 *         name: vendorId
 *         schema: { type: string, example: "3,4" }
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: manufactureStatus
 *         schema: { type: string, example: "2,3" }
 *       - in: query
 *         name: paymentStatus
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: deliveryBy
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
orderRouter.get(
  "/export",
  verifyToken,
  /* Exporting is just a different shape of the same data orders_view already
     grants in the UI (list/detail) — gating it behind finance_export left every
     non-admin, non-finance role (logistics, ops, vendor) with a silently
     corrupted download instead of a working export. */
  requirePermission("orders_view"),
  validateRequest({ query: orderExportQuerySchema }),
  asyncHandler(orderController.exportOrders),
);

/**
 * @swagger
 * /orders:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: List orders
 *     description: Returns paginated orders for the new orders page, with both legacy `orders` rows and view-friendly `items`.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: size
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: orderNumber
 *         schema: { type: string }
 *       - in: query
 *         name: operationCode
 *         schema: { type: string }
 *       - in: query
 *         name: customerName
 *         schema: { type: string }
 *       - in: query
 *         name: productCode
 *         schema: { type: string }
 *       - in: query
 *         name: vendorName
 *         schema: { type: string }
 *       - in: query
 *         name: vendorId
 *         schema: { type: string, example: "3,4" }
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: manufactureStatus
 *         schema: { type: string, example: "2,3" }
 *       - in: query
 *         name: paymentStatus
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: deliveryBy
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: orderSource
 *         schema: { type: string, example: "1,2" }
 *       - in: query
 *         name: userId
 *         schema: { type: integer }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           example: "3,2"
 *       - in: query
 *         name: sort[orderDate]
 *         description: Sort by order date. Use `-1` for newest first or `1` for oldest first.
 *         schema: { type: integer, enum: [-1, 1] }
 *       - in: query
 *         name: sort[subTotalPrice]
 *         description: Sort by subtotal price.
 *         schema: { type: integer, enum: [-1, 1] }
 *       - in: query
 *         name: sort[totalPrice]
 *         description: Sort by selling price.
 *         schema: { type: integer, enum: [-1, 1] }
 *       - in: query
 *         name: sort[priority]
 *         description: Sort by manual priority.
 *         schema: { type: integer, enum: [-1, 1] }
 *       - in: query
 *         name: deliveryStatus
 *         schema: { type: string, example: "1,2" }
 *     responses:
 *       200:
 *         description: Paginated orders response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderListResponse'
 */
orderRouter.get("/", verifyToken, requirePermission("orders_view"), validateRequest({ query: orderListQuerySchema }), asyncHandler(orderController.listOrders));

/**
 * @swagger
 * /orders/bulk-update:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Bulk update orders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderBulkUpdateRequest'
 *     responses:
 *       200:
 *         description: Orders updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 */
orderRouter.put("/bulk-update", verifyToken, requirePermission("orders_edit"), validateRequest({ body: orderBulkUpdateSchema }), asyncHandler(orderController.bulkUpdate));

/**
 * @swagger
 * /orders/import:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Import orders from Shopify
 *     responses:
 *       200:
 *         description: Orders imported successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 */
orderRouter.post("/import", verifyToken, requirePermission("orders_create"), asyncHandler(orderController.importOrders));

/**
 * @swagger
 * /orders/bulk-delete:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Bulk delete orders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderBulkDeleteRequest'
 *     responses:
 *       200:
 *         description: Orders deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 */
orderRouter.delete("/bulk-delete", verifyToken, isNotVendor, requirePermission("orders_delete"), validateRequest({ body: orderBulkDeleteSchema }), asyncHandler(orderController.bulkDelete));

/**
 * @swagger
 * /orders/{orderId}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Get order details
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Order details with additive `view` structure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderDetailsResponse'
 *       404:
 *         description: Order not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
orderRouter.get("/:orderId", verifyToken, requirePermission("orders_view"), validateRequest({ params: orderIdParamsSchema }), asyncHandler(orderController.getOrderById));

/**
 * @swagger
 * /orders/{orderId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Update an order
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderMutationRequest'
 *     responses:
 *       200:
 *         description: Updated order payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   additionalProperties: true
 *                   type: object
 *                 status:
 *                   type: boolean
 */
orderRouter.put("/:orderId", verifyToken, requirePermission("orders_edit"), validateRequest({ body: orderMutationSchema, params: orderIdParamsSchema }), asyncHandler(orderController.updateOrder));

/**
 * @swagger
 * /orders/{orderId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Delete an order
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Order deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 */
orderRouter.delete("/:orderId", verifyToken, isNotVendor, requirePermission("orders_delete"), validateRequest({ params: orderIdParamsSchema }), asyncHandler(orderController.deleteOrder));

/**
 * @swagger
 * /orders/{orderId}/notes/{noteId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Update an order note
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotePayload'
 *     responses:
 *       200:
 *         description: Updated note payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   additionalProperties: true
 *                   type: object
 *                 status:
 *                   type: boolean
 */
orderRouter.put("/:orderId/notes/:noteId", verifyToken, requirePermission("orders_edit"), validateRequest({ body: orderNoteSchema, params: orderNoteParamsSchema }), asyncHandler(orderController.updateNote));

/**
 * @swagger
 * /orders/{orderId}/notes:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Add an order note
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotePayload'
 *     responses:
 *       200:
 *         description: Note created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   additionalProperties: true
 *                   type: object
 *                 status:
 *                   type: boolean
 */
orderRouter.post("/:orderId/notes", verifyToken, requirePermission("orders_edit"), validateRequest({ body: orderNoteSchema, params: orderIdParamsSchema }), asyncHandler(orderController.addNote));

/**
 * @swagger
 * /orders/{orderId}/notes/{noteId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Delete an order note
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Note deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 */
orderRouter.delete("/:orderId/notes/:noteId", verifyToken, requirePermission("orders_edit"), validateRequest({ params: orderNoteParamsSchema }), asyncHandler(orderController.deleteNote));

/**
 * @swagger
 * /orders/{orderId}/notes/{noteId}/upload:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     summary: Upload files for an order note
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               descriptions:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Files uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 */
orderRouter.post("/:orderId/notes/:noteId/upload", verifyToken, requirePermission("orders_edit"), validateRequest({ params: orderNoteParamsSchema }), fileUploadMiddleware("note"), asyncHandler(orderController.uploadFiles));

/**
 * "محادثة السيلر مع مسؤول الحساب" — a separate, HOMIX-team-only chat thread from
 * the order notes above. isNotVendor is required explicitly here: unlike notes,
 * vendors must never see or post in this thread even though they already hold
 * orders_view/orders_edit.
 */
orderRouter.get("/:orderId/seller-chat", verifyToken, isNotVendor, requirePermission("orders_view"), validateRequest({ params: orderIdParamsSchema }), asyncHandler(orderController.listSellerChatMessages));

orderRouter.post("/:orderId/seller-chat", verifyToken, isNotVendor, requirePermission("orders_edit"), validateRequest({ body: orderSellerChatMessageSchema, params: orderIdParamsSchema }), asyncHandler(orderController.addSellerChatMessage));

orderRouter.post("/:orderId/seller-chat/:messageId/upload", verifyToken, isNotVendor, requirePermission("orders_edit"), validateRequest({ params: orderSellerChatParamsSchema }), fileUploadMiddleware("note"), asyncHandler(orderController.uploadSellerChatFiles));

orderRouter.get("/seller-chat/quick-replies", verifyToken, isNotVendor, requirePermission("orders_view"), asyncHandler(orderController.getSellerChatQuickReplies));

orderRouter.put("/seller-chat/quick-replies", verifyToken, isNotVendor, requirePermission("orders_edit"), validateRequest({ body: sellerChatQuickRepliesSchema }), asyncHandler(orderController.updateSellerChatQuickReplies));
