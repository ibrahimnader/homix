const express = require("express");
const OrderController = require("./order.controller");
const verifyToken = require("../../middlewares/protectApi");
const IsNotLogistic = require("../../middlewares/isNotLogistic");
const isNotVendor = require("../../middlewares/isNotVendor");
const OrderRouter = express.Router();

/**
 * @swagger
 * /orders:
 *   post:
 *     tags:
 *       - Orders
 *     summary: Create a new order
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order created successfully
 */
OrderRouter.post("/", OrderController.createOrder);

/**
 * @swagger
 * /orders/financialReport:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Orders
 *     summary: Get financial report
 *     parameters:
 *       - in: query
 *         name: vendorId
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
 *     responses:
 *       200:
 *         description: Financial report data
 */
OrderRouter.get(
  "/financialReport",
  verifyToken,
  IsNotLogistic,
  OrderController.financialReport
);

/**
 * @swagger
 * /orders:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Orders
 *     summary: Get all orders
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
 *         name: orderNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of orders
 */
OrderRouter.get("/", verifyToken, IsNotLogistic, OrderController.getOrders);

/**
 * @swagger
 * /orders/{orderId}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Orders
 *     summary: Get order by ID
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order details
 */
OrderRouter.get(
  "/:orderId",
  verifyToken,
  IsNotLogistic,
  OrderController.getOneOrder
);

/**
 * @swagger
 * /orders/{orderId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Orders
 *     summary: Update order
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               receivedAmount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Order updated successfully
 */
OrderRouter.put(
  "/:orderId",
  verifyToken,
  IsNotLogistic,
  OrderController.updateOrder
);
OrderRouter.put(
  "/bulk-update",
  verifyToken,
  IsNotLogistic,
  OrderController.BulkUpdate
);

/**
 * @swagger
 * /orders/import:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Orders
 *     summary: Import orders
 *     responses:
 *       200:
 *         description: Orders imported successfully
 */
OrderRouter.post(
  "/import",
  verifyToken,
  IsNotLogistic,
  OrderController.importOrders
);

/**
 *
 * @swagger
 * /orders/{orderId}:
 *  delete:
 *   security:
 *    - bearerAuth: []
 *  tags:
 *   - Orders
 * summary: Delete order
 * parameters:
 * - in: path
 *  name: orderId
 * required: true
 * schema:
 * type: string
 * responses:
 * 200:
 * description: Order deleted successfully
 */
OrderRouter.delete(
  "/:orderId",
  verifyToken,
  isNotVendor,
  OrderController.deleteOrder
);
OrderRouter.delete(
  "/bulk-delete",
  verifyToken,
  isNotVendor,
  OrderController.bulkDelete
);
/**
 * @swagger
 * /orders/{orderId}/notes/{noteId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Update order line note
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Note updated successfully
 */
OrderRouter.put(
  "/:orderId/notes/:noteId",
  verifyToken,
  isNotVendor,
  OrderController.updateNote
);

/**
 * @swagger
 * /orders/{orderId}/notes:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Add note to order line
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Note added successfully
 */
OrderRouter.post(
  "/:orderId/notes",
  verifyToken,
  isNotVendor,
  OrderController.addNote
);

/**
 * @swagger
 * /orders/{orderId}/notes/{noteId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Delete order line note
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Note deleted successfully
 */
OrderRouter.delete(
  "/:orderId/notes/:noteId",
  verifyToken,
  isNotVendor,
  OrderController.deleteNote
);

module.exports = OrderRouter;
