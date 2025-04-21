const express = require("express");
const ShipmentController = require("./shipment.controller");
const verifyToken = require("../../middlewares/protectApi");
const isNotVendor = require("../../middlewares/isNotVendor");
const ShipmentRouter = express.Router();

/**
 * @swagger
 * /shipments:
 *   post:
 *     tags:
 *       - Shipments
 *     summary: Create a new shipment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shipmentNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Shipment created successfully
 */
ShipmentRouter.post("/", ShipmentController.createShipment);


/**
 * @swagger
 * /shipments:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Shipments
 *     summary: Get all shipments
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
 *         name: shipmentNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of shipments
 */
ShipmentRouter.get("/", verifyToken, ShipmentController.getShipments);

/**
 * @swagger
 * /shipments/{shipmentId}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Shipments
 *     summary: Get shipment by ID
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shipment details
 */
ShipmentRouter.get(
  "/:shipmentId",
  verifyToken,
  ShipmentController.getOneShipment
);

/**
 * @swagger
 * /shipments/{shipmentId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Shipments
 *     summary: Update shipment
 *     parameters:
 *       - in: path
 *         name: shipmentId
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
 *         description: Shipment updated successfully
 */
ShipmentRouter.put(
  "/:shipmentId",
  verifyToken,
  ShipmentController.updateShipment
);



/**
 *
 * @swagger
 * /shipments/{shipmentId}:
 *  delete:
 *   security:
 *    - bearerAuth: []
 *  tags:
 *   - Shipments
 * summary: Delete shipment
 * parameters:
 * - in: path
 *  name: shipmentId
 * required: true
 * schema:
 * type: string
 * responses:
 * 200:
 * description: Shipment deleted successfully
 */
ShipmentRouter.delete(
  "/:shipmentId",
  verifyToken,
  isNotVendor,
  ShipmentController.deleteShipment
);
/**
 * @swagger
 * /shipments/{shipmentId}/notes/{noteId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Shipment Lines
 *     summary: Update shipment line note
 *     parameters:
 *       - in: path
 *         name: shipmentId
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
ShipmentRouter.put(
  "/:shipmentId/notes/:noteId",
  verifyToken,
  isNotVendor,
  ShipmentController.updateNote
);

/**
 * @swagger
 * /shipments/{shipmentId}/notes:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Shipment Lines
 *     summary: Add note to shipment line
 *     parameters:
 *       - in: path
 *         name: shipmentId
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
ShipmentRouter.post(
  "/:shipmentId/notes",
  verifyToken,
  isNotVendor,
  ShipmentController.addNote
);

/**
 * @swagger
 * /shipments/{shipmentId}/notes/{noteId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Shipment Lines
 *     summary: Delete shipment line note
 *     parameters:
 *       - in: path
 *         name: shipmentId
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
ShipmentRouter.delete(
  "/:shipmentId/notes/:noteId",
  verifyToken,
  isNotVendor,
  ShipmentController.deleteNote
);

module.exports = ShipmentRouter;
