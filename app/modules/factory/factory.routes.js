const express = require("express");
const FactoryController = require("./factory.controller");
const fileUploadMiddleware = require("../../../config/fileUploadMiddleware");
const FactoryRouter = express.Router();

/**
 * @swagger
 * /factories:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Get all factories
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of factories
 */
FactoryRouter.get("/", FactoryController.getAll);

/**
 * @swagger
 * /factories/{id}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Get factory by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Factory details
 */
FactoryRouter.get("/:id", FactoryController.getOne);

/**
 * @swagger
 * /factories:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Create new factory
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       201:
 *         description: Factory created successfully
 */
FactoryRouter.post("/", FactoryController.create);

/**
 * @swagger
 * /factories/{id}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Update factory
 *     parameters:
 *       - in: path
 *         name: id
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
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       200:
 *         description: Factory updated successfully
 */
FactoryRouter.put("/:id", FactoryController.update);

/**
 * @swagger
 * /factories/{id}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Delete factory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Factory deleted successfully
 */
FactoryRouter.delete("/:id", FactoryController.delete);

/**
 * @swagger
 * /factories/upload:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Upload factory file
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: File uploaded successfully
 */
FactoryRouter.post(
  "/:id/upload",
  fileUploadMiddleware("factory"),
  FactoryController.uploadFiles
);

/**
 * @swagger
 * /factories/{factoryId}/attachments/{attachmentId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Delete factory attachment
 *     parameters:
 *       - in: path
 *         name: factoryId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the factory
 *       - in: path
 *         name: attachmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the attachment to delete
 *     responses:
 *       200:
 *         description: Attachment deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 statusCode:
 *                   type: integer
 *                 message:
 *                   type: string
 *       404:
 *         description: Factory or attachment not found
 */
FactoryRouter.delete(
  "/:factoryId/attachments/:attachmentId",
  FactoryController.deleteAttachment
);
module.exports = FactoryRouter;
