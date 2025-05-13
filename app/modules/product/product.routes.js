const express = require("express");
const productsController = require("./product.controller");
const verifyToken = require("../../middlewares/protectApi");
const ProductsRouter = express.Router();

/**
 * @swagger
 * /products:
 *   post:
 *     tags:
 *       - Products
 *     summary: Create a new product
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               vendor:
 *                 type: string
 *               variants:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     title:
 *                       type: string
 *                     price:
 *                       type: number
 *                     sku:
 *                       type: string
 *     responses:
 *       200:
 *         description: Product created successfully
 */
ProductsRouter.post("/", productsController.createProduct);

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
 *           type: integer
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *       - in: query
 *         name: searchQuery
 *         schema:
 *           type: string
 *       - in: query
 *         name: vendorId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of products
 */
ProductsRouter.get("/types", verifyToken, productsController.getProductsTypes);
ProductsRouter.get("/", verifyToken, productsController.getProducts);

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
 */
ProductsRouter.get("/:id", verifyToken, productsController.getProduct);

/**
 * @swagger
 * /products/import:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Import products from Shopify
 *     responses:
 *       200:
 *         description: Products imported successfully
 */
ProductsRouter.post("/import", verifyToken, productsController.importProducts);

module.exports = ProductsRouter;