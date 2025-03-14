const express = require("express");
const VendorsController = require("./vendor.controller");
const VendorRouter = express.Router();

/**
 * @swagger
 * /vendors:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Vendors
 *     summary: Get all vendors
 *     responses:
 *       200:
 *         description: List of vendors
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       active:
 *                         type: boolean
 */
VendorRouter.get("/", VendorsController.getVendors);

/**
 * @swagger
 * /vendors/{id}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Vendors
 *     summary: Get vendor by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vendor details
 */
VendorRouter.get("/:id", VendorsController.getOneVendor);

/**
 * @swagger
 * /vendors:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Vendors
 *     summary: Create new vendor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vendor created successfully
 */
VendorRouter.post("/", VendorsController.createVendor);

/**
 * @swagger
 * /vendors/{id}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Vendors
 *     summary: Update vendor
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
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vendor updated successfully
 */
VendorRouter.put("/:id", VendorsController.updateVendor);

/**
 * @swagger
 * /vendors/{id}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Vendors
 *     summary: Delete vendor
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vendor deleted successfully
 */
VendorRouter.delete("/:id", VendorsController.deleteVendor);

/**
 * @swagger
 * /vendors/{id}/activeStatus:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Vendors
 *     summary: Toggle vendor active status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vendor status updated successfully
 */
VendorRouter.put("/:id/activeStatus", VendorsController.changeActiveStatus);

module.exports = VendorRouter;