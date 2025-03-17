const express = require("express");
const verifyToken = require("../../middlewares/protectApi");
const productsController = require("./product.controller");
const CategoriesRouter = express.Router();

/**
 * @swagger
 * /categories:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Categories
 *     summary: Get all categories
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
 *         description: List of categories
 */
CategoriesRouter.get("/", verifyToken, productsController.getAllCategories);

module.exports = CategoriesRouter;