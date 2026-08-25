import express from "express";

import { asyncHandler, validateRequest } from "../../shared/http";
import { ShipmentController } from "./shipment.controller";
import { ShipmentRepository } from "./shipment.repo";
import {
  shipmentBulkUpdateSchema,
  shipmentCreateSchema,
  shipmentDeliveryAccountBulkMutationSchema,
  shipmentDeliveryAccountMutationSchema,
  shipmentDeliveryAccountParamsSchema,
  shipmentDeliveryAccountsExportQuerySchema,
  shipmentDeliveryAccountsQuerySchema,
  shipmentExpenseAccountsExportQuerySchema,
  shipmentExportQuerySchema,
  shipmentExpenseBulkMutationSchema,
  shipmentExpenseMutationSchema,
  shipmentExpenseTypesMutationSchema,
  shipmentExpenseParamsSchema,
  shipmentExpenseAccountsQuerySchema,
  shipmentIdParamsSchema,
  shipmentInventoryItemParamsSchema,
  shipmentInventoryMutationSchema,
  shipmentInventoryExportQuerySchema,
  shipmentInventoryQuerySchema,
  shipmentListQuerySchema,
  shipmentMutationSchema,
  shipmentNoteParamsSchema,
  shipmentNoteSchema,
  shipmentPerformanceQuerySchema,
  shipmentShippingCompaniesQuerySchema,
  shipmentShippingCompanyMutationSchema,
  shipmentShippingCompanyParamsSchema,
  shipmentReturnMutationSchema,
  shipmentReturnsExportQuerySchema,
  shipmentReturnUpdateSchema,
  shipmentReturnParamsSchema,
  shipmentReturnsQuerySchema,
  shipmentSummaryQuerySchema,
} from "./shipment.schemas";
import { ShipmentService } from "./shipment.service";

const verifyToken = require("../../../app/middlewares/protectApi");
const isNotVendor = require("../../../app/middlewares/isNotVendor");
const requirePermission = require("../../../app/middlewares/requirePermission");
const fileUploadMiddleware = require("../../../config/fileUploadMiddleware");

const shipmentRepository = new ShipmentRepository();
const shipmentService = new ShipmentService(shipmentRepository);
const shipmentController = new ShipmentController(shipmentService);

export const shipmentRouter = express.Router();

shipmentRouter.use(verifyToken, isNotVendor);

/**
 * @swagger
 * /shipments/meta:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Get shipments page metadata
 *     description: Returns the tabs and filter options for the new shipping and delivery workspace.
 *     responses:
 *       200:
 *         description: Shipments metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentMetaResponse'
 */
shipmentRouter.get("/meta", requirePermission("ship_view"), asyncHandler(shipmentController.getMeta));

/**
 * @swagger
 * /shipments/summary:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Get shipments summary cards
 *     parameters:
 *       - in: query
 *         name: operationCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: orderNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: orderSource
 *         description: CSV of numeric order source values. `1` = شو رووم, `2` = اونلاين.
 *         schema:
 *           type: string
 *           example: 1,2
 *       - in: query
 *         name: customerName
 *         schema:
 *           type: string
 *       - in: query
 *         name: customerPhone
 *         schema:
 *           type: string
 *       - in: query
 *         name: vendorName
 *         schema:
 *           type: string
 *       - in: query
 *         name: shipmentNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: shipmentStatus
 *         description: CSV of numeric shipment statuses.
 *         schema:
 *           type: string
 *           example: 2,3,4
 *       - in: query
 *         name: scheduleStatus
 *         description: CSV of numeric scheduling statuses. `1` = مجدول, `2` = لا يوجد رد, `3` = مؤجل, `4` = الغاء تأخير في التوصيل, `5` = الغاء تغيير رأي, `6` = الغاء لا يوجد رد, `7` = إعادة الاتصال لاحقا.
 *         schema:
 *           type: string
 *           example: 1,3
 *       - in: query
 *         name: paymentStatus
 *         description: CSV of numeric payment statuses.
 *         schema:
 *           type: string
 *           example: 1,2
 *       - in: query
 *         name: priority
 *         description: CSV of numeric delivery priority values. `1` = بالمدة, `2` = مستعجل, `3` = مستعجل جدا.
 *         schema:
 *           type: string
 *           example: 1,3
 *       - in: query
 *         name: shipmentType
 *         schema:
 *           type: string
 *       - in: query
 *         name: deliveryBy
 *         description: CSV of delivery provider ids or a shipping company text match.
 *         schema:
 *           type: string
 *       - in: query
 *         name: governorate
 *         description: CSV of governorate ids.
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: deliveryDateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: deliveryDateTo
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: scheduledDateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: scheduledDateTo
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Shipment summary cards
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentSummaryResponse'
 */
shipmentRouter.get(
  "/summary",
  requirePermission("ship_view"),
  validateRequest({ query: shipmentSummaryQuerySchema }),
  asyncHandler(shipmentController.getSummary),
);

/**
 * @swagger
 * /shipments:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Create a shipment
 *     description: Accepts the same legacy-compatible order-style payload used for manual order creation, with shipment-specific fields. The backend always forces `shippedFromInventory = true`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentCreateRequest'
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
 *               shippingCompany: 3
 *               governorate: الجيزة
 *               scheduleStatus: 1
 *               shipmentStatus: 2
 *               shipmentType: grouped
 *               shippingReceiveDate: 2026-06-18T00:00:00.000Z
 *               deliveryDate: 2026-06-20T00:00:00.000Z
 *               deliveryBy: 1
 *               priority: 1
 *               shippingFees: 65
 *               toBeCollected: 29998
 *     responses:
 *       200:
 *         description: Shipment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentMessageResponse'
 */
shipmentRouter.post("/", requirePermission("ship_edit"), validateRequest({ body: shipmentCreateSchema }), asyncHandler(shipmentController.createShipment));

/**
 * @swagger
 * /shipments/shipping-companies:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: List shipping companies
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shipping companies
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentShippingCompanyListResponse'
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Create a shipping company
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentShippingCompanyRequest'
 *     responses:
 *       201:
 *         description: Shipping company created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentShippingCompanyItemResponse'
 */
shipmentRouter.get(
  "/shipping-companies",
  requirePermission("ship_view"),
  validateRequest({ query: shipmentShippingCompaniesQuerySchema }),
  asyncHandler(shipmentController.listShippingCompanies),
);

shipmentRouter.post(
  "/shipping-companies",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentShippingCompanyMutationSchema }),
  asyncHandler(shipmentController.createShippingCompany),
);

shipmentRouter.put(
  "/accounts/expense-types",
  requirePermission("finance_settle"),
  validateRequest({ body: shipmentExpenseTypesMutationSchema }),
  asyncHandler(shipmentController.updateExpenseTypes),
);

/**
 * @swagger
 * /shipments/shipping-companies/{shippingCompanyId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update a shipping company
 *     parameters:
 *       - in: path
 *         name: shippingCompanyId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentShippingCompanyRequest'
 *     responses:
 *       200:
 *         description: Shipping company updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentShippingCompanyItemResponse'
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Delete a shipping company
 *     parameters:
 *       - in: path
 *         name: shippingCompanyId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Shipping company deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentMessageResponse'
 */
shipmentRouter.put(
  "/shipping-companies/:shippingCompanyId",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentShippingCompanyMutationSchema, params: shipmentShippingCompanyParamsSchema }),
  asyncHandler(shipmentController.updateShippingCompany),
);

shipmentRouter.delete(
  "/shipping-companies/:shippingCompanyId",
  requirePermission("ship_edit"),
  validateRequest({ params: shipmentShippingCompanyParamsSchema }),
  asyncHandler(shipmentController.deleteShippingCompany),
);

/**
 * @swagger
 * /shipments/export:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Export shipments
 *     description: Uses the legacy export flow and returns a file stream rather than a JSON body.
 *     parameters:
 *       - in: query
 *         name: orderNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: vendorName
 *         schema:
 *           type: string
 *       - in: query
 *         name: paymentStatus
 *         description: Numeric payment status id used by the legacy exporter.
 *         schema:
 *           type: integer
 *       - in: query
 *         name: financialStatus
 *         description: Legacy financial status filter.
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         description: CSV of legacy order statuses.
 *         schema:
 *           type: string
 *       - in: query
 *         name: deliveryStatus
 *         description: CSV of legacy delivery aging buckets.
 *         schema:
 *           type: string
 *           example: 1,2
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Export stream
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
shipmentRouter.get(
  "/export",
  // The workbook contains the same shipment rows granted by ship_view; it is
  // not a financial report and must remain available to logistics users.
  requirePermission("ship_view"),
  validateRequest({ query: shipmentExportQuerySchema }),
  asyncHandler(shipmentController.exportShipments),
);

/**
 * @swagger
 * /shipments/returns/vendor:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: List vendor returns
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: operationCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: orderNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: sellerName
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Vendor returns
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentReturnListResponse'
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Create a vendor return workflow record
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, reason]
 *             properties:
 *               orderId:
 *                 type: integer
 *                 example: 9802
 *               reason:
 *                 type: string
 *                 example: منتج تالف
 *               returnDate:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-05-18T00:00:00.000Z
 *               status:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       201:
 *         description: Vendor return created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentReturnItemResponse'
 */
shipmentRouter.get(
  "/returns/vendor",
  requirePermission("ship_returns_view"),
  validateRequest({ query: shipmentReturnsQuerySchema }),
  asyncHandler(shipmentController.listVendorReturns),
);

shipmentRouter.get(
  "/returns/vendor/export",
  requirePermission("ship_returns_view"),
  validateRequest({ query: shipmentReturnsExportQuerySchema }),
  asyncHandler(shipmentController.exportVendorReturns),
);

shipmentRouter.post(
  "/returns/vendor",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentReturnMutationSchema }),
  asyncHandler(shipmentController.createVendorReturn),
);

shipmentRouter.put(
  "/returns/vendor/:returnId",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentReturnUpdateSchema, params: shipmentReturnParamsSchema }),
  asyncHandler(shipmentController.updateVendorReturn),
);

/**
 * @swagger
 * /shipments/returns/vendor/{returnId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update a vendor return workflow record
 *     parameters:
 *       - in: path
 *         name: returnId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentReturnMutationRequest'
 *     responses:
 *       200:
 *         description: Vendor return updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentReturnItemResponse'
 */

/**
 * @swagger
 * /shipments/returns/customer:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: List customer returns
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: operationCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: orderNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: sellerName
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Customer returns
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentReturnListResponse'
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Create a customer withdrawal workflow record
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, reason]
 *             properties:
 *               orderId:
 *                 type: integer
 *                 example: 9802
 *               reason:
 *                 type: string
 *                 example: العميل رفض الاستلام
 *               returnDate:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-05-18T00:00:00.000Z
 *               status:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       201:
 *         description: Customer withdrawal created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentReturnItemResponse'
 */
shipmentRouter.get(
  "/returns/customer",
  requirePermission("ship_returns_view"),
  validateRequest({ query: shipmentReturnsQuerySchema }),
  asyncHandler(shipmentController.listCustomerReturns),
);

shipmentRouter.get(
  "/returns/customer/export",
  requirePermission("ship_returns_view"),
  validateRequest({ query: shipmentReturnsExportQuerySchema }),
  asyncHandler(shipmentController.exportCustomerReturns),
);

shipmentRouter.post(
  "/returns/customer",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentReturnMutationSchema }),
  asyncHandler(shipmentController.createCustomerReturn),
);

shipmentRouter.put(
  "/returns/customer/:returnId",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentReturnUpdateSchema, params: shipmentReturnParamsSchema }),
  asyncHandler(shipmentController.updateCustomerReturn),
);

/**
 * @swagger
 * /shipments/returns/customer/{returnId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update a customer withdrawal workflow record
 *     parameters:
 *       - in: path
 *         name: returnId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentReturnMutationRequest'
 *     responses:
 *       200:
 *         description: Customer withdrawal updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentReturnItemResponse'
 */

/**
 * @swagger
 * /shipments/inventory:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: List shipping inventory items
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: productCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: vendorName
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Inventory list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentInventoryListResponse'
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Create a manual inventory row linked to an existing product
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, productCode, quantity, costPrice]
 *             properties:
 *               productId:
 *                 type: integer
 *                 example: 321
 *               productCode:
 *                 type: string
 *                 example: DRS-102
 *               quantity:
 *                 type: integer
 *                 example: 2
 *               costPrice:
 *                 type: number
 *                 example: 2800
 *               size:
 *                 type: string
 *                 example: 50x120
 *               color:
 *                 type: string
 *                 example: أبيض
 *               status:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       201:
 *         description: Inventory row created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentInventoryItemResponse'
 */
shipmentRouter.get(
  "/inventory",
  requirePermission("ship_inventory_view"),
  validateRequest({ query: shipmentInventoryQuerySchema }),
  asyncHandler(shipmentController.listInventory),
);

shipmentRouter.get(
  "/inventory/export",
  requirePermission("ship_inventory_view"),
  validateRequest({ query: shipmentInventoryExportQuerySchema }),
  asyncHandler(shipmentController.exportInventory),
);

shipmentRouter.post(
  "/inventory",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentInventoryMutationSchema }),
  asyncHandler(shipmentController.createInventoryItem),
);

/**
 * @swagger
 * /shipments/inventory/{inventoryItemId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update a manual inventory row
 *     parameters:
 *       - in: path
 *         name: inventoryItemId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentInventoryMutationRequest'
 *     responses:
 *       200:
 *         description: Inventory row updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentInventoryItemResponse'
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Delete a manual inventory row
 *     parameters:
 *       - in: path
 *         name: inventoryItemId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Inventory row deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentMessageResponse'
 */
shipmentRouter.put(
  "/inventory/:inventoryItemId",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentInventoryMutationSchema.partial(), params: shipmentInventoryItemParamsSchema }),
  asyncHandler(shipmentController.updateInventoryItem),
);

shipmentRouter.delete(
  "/inventory/:inventoryItemId",
  requirePermission("ship_edit"),
  validateRequest({ params: shipmentInventoryItemParamsSchema }),
  asyncHandler(shipmentController.deleteInventoryItem),
);

/**
 * @swagger
 * /shipments/accounts/deliveries:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: List shipment delivery accounting rows
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: orderNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: accountingStatus
 *         schema:
 *           type: integer
 *       - in: query
 *         name: paymentMethod
 *         schema:
 *           type: string
 *       - in: query
 *         name: settledDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Delivery accounting rows
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentDeliveryAccountsListResponse'
 */
shipmentRouter.get(
  "/accounts/deliveries",
  requirePermission("ship_delivery_accounts_view"),
  validateRequest({ query: shipmentDeliveryAccountsQuerySchema }),
  asyncHandler(shipmentController.listDeliveryAccounts),
);

shipmentRouter.get(
  "/accounts/deliveries/export",
  requirePermission("ship_delivery_accounts_view"),
  validateRequest({ query: shipmentDeliveryAccountsExportQuerySchema }),
  asyncHandler(shipmentController.exportDeliveryAccounts),
);

/**
 * @swagger
 * /shipments/accounts/deliveries/{orderId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update the accounting state of a delivered shipment
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accountingStatus:
 *                 type: integer
 *                 description: 1 = pending, 2 = settled
 *               accountingDate:
 *                 type: string
 *               accountingReference:
 *                 type: string
 *     responses:
 *       200:
 *         description: Delivery account updated successfully
 *       404:
 *         description: Delivery account not found
 */
/**
 * @swagger
 * /shipments/accounts/deliveries/bulk-update:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update the accounting state of several delivered shipments at once
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderIds, data]
 *             properties:
 *               orderIds:
 *                 type: array
 *                 items: { type: integer }
 *               data:
 *                 type: object
 *                 properties:
 *                   accountingStatus:
 *                     type: integer
 *                     description: 1 = pending, 2 = settled
 *                   accountingDate:
 *                     type: string
 *                   accountingReference:
 *                     type: string
 *     responses:
 *       200:
 *         description: Delivery accounts updated successfully
 */
shipmentRouter.put(
  "/accounts/deliveries/bulk-update",
  requirePermission("finance_settle"),
  validateRequest({ body: shipmentDeliveryAccountBulkMutationSchema }),
  asyncHandler(shipmentController.bulkUpdateDeliveryAccounts),
);

shipmentRouter.put(
  "/accounts/deliveries/:orderId",
  requirePermission("finance_settle"),
  validateRequest({ body: shipmentDeliveryAccountMutationSchema, params: shipmentDeliveryAccountParamsSchema }),
  asyncHandler(shipmentController.updateDeliveryAccount),
);

/**
 * @swagger
 * /shipments/accounts/deliveries/{orderId}/reference:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Attach the reference document for a delivery's accounting record
 *     description: "المرجع" is a single uploaded file (image or PDF), not free text — this stores it and records its path as the delivery's accountingReference.
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Reference attachment saved
 *       400:
 *         description: No file uploaded
 */
shipmentRouter.post(
  "/accounts/deliveries/:orderId/reference",
  // Logistics owns shipment documents. Uploading a reference must not grant
  // the separate finance_settle capability used to settle accounting rows.
  requirePermission("ship_edit"),
  validateRequest({ params: shipmentDeliveryAccountParamsSchema }),
  fileUploadMiddleware("delivery-reference"),
  asyncHandler(shipmentController.uploadDeliveryAccountReference),
);

/**
 * @swagger
 * /shipments/accounts/expenses:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: List shipment expenses rows
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: accountingStatus
 *         schema:
 *           type: integer
 *       - in: query
 *         name: type
 *         description: Numeric expense type id.
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Expenses accounting rows
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentExpenseAccountsListResponse'
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Create a shipment expense row
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentExpenseMutationRequest'
 *     responses:
 *       201:
 *         description: Expense row created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentExpenseAccountItemResponse'
 */
shipmentRouter.get(
  "/accounts/expenses",
  requirePermission("ship_expenses_view"),
  validateRequest({ query: shipmentExpenseAccountsQuerySchema }),
  asyncHandler(shipmentController.listExpenseAccounts),
);

shipmentRouter.get(
  "/accounts/expenses/export",
  requirePermission("ship_expenses_view"),
  validateRequest({ query: shipmentExpenseAccountsExportQuerySchema }),
  asyncHandler(shipmentController.exportExpenseAccounts),
);

shipmentRouter.post(
  "/accounts/expenses",
  requirePermission("finance_settle"),
  validateRequest({ body: shipmentExpenseMutationSchema }),
  asyncHandler(shipmentController.createExpenseAccount),
);

shipmentRouter.put(
  "/accounts/expenses/bulk-update",
  requirePermission("finance_settle"),
  validateRequest({ body: shipmentExpenseBulkMutationSchema }),
  asyncHandler(shipmentController.bulkUpdateExpenseAccounts),
);

shipmentRouter.put(
  "/accounts/expenses/:expenseId",
  requirePermission("finance_settle"),
  validateRequest({ body: shipmentExpenseMutationSchema.partial(), params: shipmentExpenseParamsSchema }),
  asyncHandler(shipmentController.updateExpenseAccount),
);

/**
 * @swagger
 * /shipments/accounts/expenses/{expenseId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update a shipment expense row
 *     parameters:
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentExpenseMutationRequest'
 *     responses:
 *       200:
 *         description: Expense row updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentExpenseAccountItemResponse'
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Delete a shipment expense row
 *     parameters:
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Expense row deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentMessageResponse'
 */

shipmentRouter.delete(
  "/accounts/expenses/:expenseId",
  requirePermission("finance_settle"),
  validateRequest({ params: shipmentExpenseParamsSchema }),
  asyncHandler(shipmentController.deleteExpenseAccount),
);

/**
 * @swagger
 * /shipments/performance:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Get shipment performance report
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, custom]
 *           default: daily
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Shipment performance report
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentPerformanceResponse'
 */
shipmentRouter.get(
  "/performance",
  requirePermission("ship_performance_view"),
  validateRequest({ query: shipmentPerformanceQuerySchema }),
  asyncHandler(shipmentController.getPerformance),
);

shipmentRouter.get(
  "/performance/export",
  requirePermission("ship_performance_view"),
  validateRequest({ query: shipmentPerformanceQuerySchema }),
  asyncHandler(shipmentController.exportPerformance),
);

/**
 * @swagger
 * /shipments:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: List shipments
 *     responses:
 *       200:
 *         description: Shipment list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentListResponse'
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: operationCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: orderNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: orderSource
 *         description: CSV of numeric order source values. `1` = شو رووم, `2` = اونلاين.
 *         schema:
 *           type: string
 *           example: 1,2
 *       - in: query
 *         name: customerName
 *         schema:
 *           type: string
 *       - in: query
 *         name: customerPhone
 *         schema:
 *           type: string
 *       - in: query
 *         name: shipmentStatus
 *         description: CSV of numeric shipment statuses
 *         schema:
 *           type: string
 *           example: 2,3,4
 *       - in: query
 *         name: scheduleStatus
 *         description: CSV of numeric scheduling statuses. `1` = مجدول, `2` = لا يوجد رد, `3` = مؤجل, `4` = الغاء تأخير في التوصيل, `5` = الغاء تغيير رأي, `6` = الغاء لا يوجد رد, `7` = إعادة الاتصال لاحقا.
 *         schema:
 *           type: string
 *           example: 1,3
 *       - in: query
 *         name: paymentStatus
 *         description: CSV of numeric payment statuses
 *         schema:
 *           type: string
 *           example: 1,2
 *       - in: query
 *         name: priority
 *         description: CSV of numeric delivery priority values. `1` = بالمدة, `2` = مستعجل, `3` = مستعجل جدا.
 *         schema:
 *           type: string
 *           example: 1,3
 *       - in: query
 *         name: sort[orderDate]
 *         description: Sort by order date. Use `-1` for newest first or `1` for oldest first.
 *         schema:
 *           type: integer
 *           enum: [-1, 1]
 *       - in: query
 *         name: sort[subTotalPrice]
 *         description: Sort by subtotal price.
 *         schema:
 *           type: integer
 *           enum: [-1, 1]
 *       - in: query
 *         name: sort[totalPrice]
 *         description: Sort by selling price.
 *         schema:
 *           type: integer
 *           enum: [-1, 1]
 *       - in: query
 *         name: sort[priority]
 *         description: Sort by manual priority.
 *         schema:
 *           type: integer
 *           enum: [-1, 1]
 *       - in: query
 *         name: shipmentNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: shipmentType
 *         schema:
 *           type: string
 *       - in: query
 *         name: deliveryBy
 *         description: CSV of delivery provider ids or a shipping company text match
 *         schema:
 *           type: string
 *       - in: query
 *         name: vendorName
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: deliveryDateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: deliveryDateTo
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: scheduledDateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: scheduledDateTo
 *         schema:
 *           type: string
 *           format: date
 */
shipmentRouter.get(
  "/",
  requirePermission("ship_view"),
  validateRequest({ query: shipmentListQuerySchema }),
  asyncHandler(shipmentController.listShipments),
);

/**
 * @swagger
 * /shipments/bulk-update:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update several shipments at once (status, type, governorate, delivery-by, assignee)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shipmentIds, data]
 *             properties:
 *               shipmentIds:
 *                 type: array
 *                 items: { type: integer }
 *               data:
 *                 type: object
 *                 properties:
 *                   shipmentStatus: { type: integer }
 *                   shipmentType: { type: string }
 *                   governorate: { type: string }
 *                   deliveryBy: { type: integer }
 *                   userId: { type: integer }
 *     responses:
 *       200:
 *         description: Shipments updated successfully
 */
shipmentRouter.put(
  "/bulk-update",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentBulkUpdateSchema }),
  asyncHandler(shipmentController.bulkUpdateShipments),
);

/**
 * @swagger
 * /shipments/{shipmentId}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Get shipment details
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Shipment details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentDetailsResponse'
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update a shipment
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentUpdateRequest'
 *     responses:
 *       200:
 *         description: Shipment updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentUpdateResponse'
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Delete a shipment
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Shipment deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentMessageResponse'
 */
shipmentRouter.get(
  "/:shipmentId",
  requirePermission("ship_view"),
  validateRequest({ params: shipmentIdParamsSchema }),
  asyncHandler(shipmentController.getShipmentById),
);

shipmentRouter.put(
  "/:shipmentId",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentMutationSchema, params: shipmentIdParamsSchema }),
  asyncHandler(shipmentController.updateShipment),
);

shipmentRouter.delete(
  "/:shipmentId",
  requirePermission("ship_edit"),
  validateRequest({ params: shipmentIdParamsSchema }),
  asyncHandler(shipmentController.deleteShipment),
);

shipmentRouter.post(
  "/:shipmentId/notes",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentNoteSchema, params: shipmentIdParamsSchema }),
  asyncHandler(shipmentController.addNote),
);

/**
 * @swagger
 * /shipments/{shipmentId}/notes:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Add a shipment note
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentNoteRequest'
 *     responses:
 *       200:
 *         description: Note created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentNoteResponse'
 */

shipmentRouter.put(
  "/:shipmentId/notes/:noteId",
  requirePermission("ship_edit"),
  validateRequest({ body: shipmentNoteSchema, params: shipmentNoteParamsSchema }),
  asyncHandler(shipmentController.updateNote),
);

/**
 * @swagger
 * /shipments/{shipmentId}/notes/{noteId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Update a shipment note
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipmentNoteRequest'
 *     responses:
 *       200:
 *         description: Note updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentNoteResponse'
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Shipments]
 *     summary: Delete a shipment note
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Note deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipmentMessageResponse'
 */

shipmentRouter.delete(
  "/:shipmentId/notes/:noteId",
  requirePermission("ship_edit"),
  validateRequest({ params: shipmentNoteParamsSchema }),
  asyncHandler(shipmentController.deleteNote),
);
