const express = require("express");
const verifyToken = require("../../middlewares/protectApi");
const OrderLineController = require("./orderLine.controller");
const IsNotLogistic = require("../../middlewares/isNotLogistic"); 
const isAdmin = require("../../middlewares/isAdmin");
const OrderLineRouter = express.Router();

/**
 * @swagger
 * /orderLines/{orderLineId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Update order line
 *     parameters:
 *       - in: path
 *         name: orderLineId
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
 *               notes:
 *                 type: string
 *               status:
 *                 type: integer
 *               cost:
 *                 type: number
 *               color:
 *                 type: string
 *               size:
 *                 type: string
 *               material:
 *                 type: string
 *               itemStatus:
 *                 type: integer
 *               itemShipping:
 *                 type: number
 *               toBeCollected:
 *                 type: number
 *     responses:
 *       200:
 *         description: Order line updated successfully
 */
OrderLineRouter.put(
  "/:orderLineId",
  verifyToken,
  IsNotLogistic,
  OrderLineController.updateOrderLine
);

/**
 * @swagger
 * /orderLines/{orderLineId}/notes/{noteId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Update order line note
 *     parameters:
 *       - in: path
 *         name: orderLineId
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
OrderLineRouter.put(
  "/:orderLineId/notes/:noteId",
  verifyToken, 
  isAdmin,
  OrderLineController.updateNote
);

/**
 * @swagger
 * /orderLines/{orderLineId}/notes:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Add note to order line
 *     parameters:
 *       - in: path
 *         name: orderLineId
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
OrderLineRouter.post(
  "/:orderLineId/notes",
  verifyToken,
  IsNotLogistic,
  OrderLineController.addNote
);

/**
 * @swagger
 * /orderLines/{orderLineId}/notes/{noteId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Delete order line note
 *     parameters:
 *       - in: path
 *         name: orderLineId
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
OrderLineRouter.delete(
  "/:orderLineId/notes/:noteId",
  verifyToken,
  isAdmin,
  OrderLineController.deleteNote
);

module.exports = OrderLineRouter;