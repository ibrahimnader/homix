import express from "express";

import { ForbiddenError } from "../../../src/shared/errors";
import { asyncHandler, validateRequest } from "../../../src/shared/http";
import { USER_TYPES } from "../../../config/constants";
import { createSystemProductSchema, duplicateProductSchema, productIdParamsSchema } from "./product.schemas";

const productsController = require("./product.controller") as typeof import("./product.controller");
const verifyToken = require("../../middlewares/protectApi") as typeof import("../../middlewares/protectApi");
const requirePermission = require("../../middlewares/requirePermission") as (permissionKey: string) => express.RequestHandler;

const ProductsRouter = express.Router();

/** System products are created by staff only: a vendor never may, whatever their permission map says
 *  (vendors do not hold `products_edit` in any template, and a stray grant must not open this up). */
const staffOnlyProductWrite: express.RequestHandler = (request, _response, next) => {
  if (String((request.user as { userType?: unknown } | undefined)?.userType) === String(USER_TYPES.VENDOR)) {
    throw new ForbiddenError("البائع لا يملك صلاحية إنشاء المنتجات");
  }
  next();
};
const { handleShopifyProductWebhook } = require("./product.webhook") as typeof import("./product.webhook");

/**
 * @swagger
 * /products:
 *   post:
 *     tags:
 *       - Products
 *     summary: Create a new product
 *     description: Product webhook-style endpoint used to persist a single imported product payload.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductPayload'
 *           examples:
 *             createProduct:
 *               value:
 *                 name: دريسينج هاوس
 *                 vendor: ركنة للأثاث
 *                 category: غرف نوم
 *                 productType: دريسنج
 *                 price: "16999"
 *     responses:
 *       200:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 */
// Deliberately no verifyToken: Shopify authenticates with an HMAC signature.
ProductsRouter.post("/webhook", handleShopifyProductWebhook);

ProductsRouter.post("/", verifyToken, requirePermission("products_edit"), productsController.createProduct);

/**
 * @swagger
 * /products/system:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Create a product inside the system
 *     description: >
 *       Creates a brand-new product with no Shopify id (`isSystemCreated=true`). It is never overwritten or
 *       deleted by the Shopify sync and can be used as an order line (`product_id` = `local:<id>`).
 *       Requires `products_edit`; vendors are always rejected with 403. Setting a cost needs `orders_edit_financials`.
 *       A variant without `sku` gets a unique generated one; an explicit duplicate `sku` answers 409.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, vendorId, variants]
 *             properties:
 *               title: { type: string, example: "دريسينج جديد" }
 *               vendorId: { type: integer, example: 4 }
 *               typeId: { type: integer, nullable: true, example: 3 }
 *               image: { type: string, nullable: true, example: "https://example.com/p.png" }
 *               variants:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [price]
 *                   properties:
 *                     title: { type: string, example: "أبيض" }
 *                     sku: { type: string, example: "DRS-001" }
 *                     price: { type: number, example: 16999 }
 *                     cost: { type: number, example: 12000 }
 *                     color: { type: string }
 *                     size: { type: string }
 *                     material: { type: string }
 *     responses:
 *       201:
 *         description: Product created
 *       400:
 *         description: Validation error (unknown vendor/type, bad body)
 *       401:
 *         description: Missing or invalid bearer token
 *       403:
 *         description: Vendor, missing products_edit, or cost set without orders_edit_financials
 *       409:
 *         description: A given variant sku is already used by another product
 */
ProductsRouter.post(
  "/system",
  verifyToken,
  staffOnlyProductWrite,
  requirePermission("products_edit"),
  validateRequest({ body: createSystemProductSchema }),
  asyncHandler(productsController.createSystemProduct),
);

/**
 * @swagger
 * /products/{id}/duplicate:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Duplicate a product into a new system product
 *     description: >
 *       Copies title, vendor, type, image, variants (price, cost, color/size/material) and category links of the
 *       source product, but never its Shopify ids. Variant codes are regenerated unique (`RKA-001` becomes `RKA-001-C1`).
 *       Every body field is optional and overrides the copied value (the edited form). Same permissions as
 *       `POST /products/system`; changing a cost needs `orders_edit_financials`.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               vendorId: { type: integer }
 *               typeId: { type: integer, nullable: true }
 *               image: { type: string, nullable: true }
 *               variants:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [price]
 *                   properties:
 *                     title: { type: string }
 *                     sku: { type: string }
 *                     price: { type: number }
 *                     cost: { type: number }
 *                     color: { type: string }
 *                     size: { type: string }
 *                     material: { type: string }
 *     responses:
 *       201:
 *         description: Product duplicated
 *       400:
 *         description: Validation error
 *       403:
 *         description: Vendor, missing products_edit, or cost changed without orders_edit_financials
 *       404:
 *         description: Source product not found
 *       409:
 *         description: A given variant sku is already used by another product
 */
ProductsRouter.post(
  "/:id/duplicate",
  verifyToken,
  staffOnlyProductWrite,
  requirePermission("products_edit"),
  validateRequest({ params: productIdParamsSchema, body: duplicateProductSchema }),
  asyncHandler(productsController.duplicateProduct),
);

/**
 * @swagger
 * /products/types:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Get all product types
 *     description: Returns the available product type names used for filtering and product creation.
 *     responses:
 *       200:
 *         description: Product types list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductTypesResponse'
 *       401:
 *         description: Missing or invalid bearer token
 */
ProductsRouter.get("/types", verifyToken, requirePermission("products_view"), productsController.getProductsTypes);

/**
 * @swagger
 * /products:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Get all products
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: string
 *         example: "1"
 *       - in: query
 *         name: size
 *         schema:
 *           type: string
 *         example: "20"
 *       - in: query
 *         name: searchQuery
 *         schema:
 *           type: string
 *         example: دريسينج
 *       - in: query
 *         name: vendorsIds
 *         schema:
 *           type: string
 *         description: Comma-separated vendor IDs
 *         example: "4,6"
 *       - in: query
 *         name: categoriesIds
 *         schema:
 *           type: string
 *         description: Comma-separated category IDs
 *         example: "1,2"
 *       - in: query
 *         name: typesIds
 *         schema:
 *           type: string
 *         description: Comma-separated product type IDs
 *         example: "3,8"
 *     responses:
 *       200:
 *         description: List of products
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductListResponse'
 *       401:
 *         description: Missing or invalid bearer token
 */
ProductsRouter.get("/", verifyToken, requirePermission("products_view"), productsController.getProducts);

/**
 * @swagger
 * /products/{id}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Get product by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductResponse'
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Product not found
 */
ProductsRouter.get("/:id", verifyToken, requirePermission("products_view"), productsController.getProduct);

/**
 * @swagger
 * /products/import:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Import products from Shopify
 *     description: Imports products from the configured Shopify store into the local catalog.
 *     responses:
 *       200:
 *         description: Products imported successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *             examples:
 *               imported:
 *                 value:
 *                   message: Products imported successfully
 *                   status: true
 *                   statusCode: 200
 *       401:
 *         description: Missing or invalid bearer token
 */
ProductsRouter.post("/import", verifyToken, requirePermission("products_import"), productsController.importProducts);

export = ProductsRouter;
