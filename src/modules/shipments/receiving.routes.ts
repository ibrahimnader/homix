import { Router } from "express";
import { z } from "zod";
import { logger } from "../../shared/logger";
import { asyncHandler, validateRequest } from "../../shared/http";
import {
  receivingCreateSchema,
  receivingDocumentSchema,
  receivingListSchema,
  receivingReceivedFilterSchema,
  receivingExportSchema,
  receivingDocumentParams,
  receivingUpdateSchema,
} from "./receiving.schemas";
import { ReceivingService } from "./receiving.service";
const requirePermission = require("../../../app/middlewares/requirePermission");
const service = new ReceivingService();
export const receivingRouter = Router();
// Parent shipment router already enforces authentication and excludes vendors.
receivingRouter.use(requirePermission("ship_receipts_view"));
receivingRouter.get(
  "/candidates",
  validateRequest({ query: receivingListSchema }),
  asyncHandler(async (req, res) => {
    res.json({ status: true, data: await service.candidates(req.query as never) });
  })
);
receivingRouter.get(
  "/vendors",
  asyncHandler(async (_req, res) => {
    res.json({ status: true, data: await service.receivedVendors() });
  })
);
receivingRouter.get(
  "/export",
  validateRequest({ query: receivingExportSchema }),
  asyncHandler(async (req, res) => {
    await service.exportWorkbook(res, req.query as never);
  })
);
receivingRouter.get(
  "/",
  validateRequest({ query: receivingReceivedFilterSchema }),
  asyncHandler(async (req, res) => {
    res.json({ status: true, data: await service.list(req.query as never) });
  })
);
receivingRouter.get(
  "/documents",
  validateRequest({ query: receivingListSchema }),
  asyncHandler(async (req, res) => {
    res.json({ status: true, data: await service.documents(req.query as never) });
  })
);
receivingRouter.get(
  "/documents/:number",
  validateRequest({ params: receivingDocumentParams }),
  asyncHandler(async (req, res) => {
    res.json({ status: true, data: await service.getDocument(String(req.params.number)) });
  })
);
receivingRouter.post(
  "/documents",
  requirePermission("ship_edit"),
  validateRequest({ body: receivingDocumentSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      status: true,
      data: await service.printDocument(req.body.orderIds),
    });
  })
);
receivingRouter.post(
  "/",
  requirePermission("ship_edit"),
  validateRequest({ body: receivingCreateSchema }),
  asyncHandler(async (req, res) => {
    const data = await service.receive(req.body, Number(req.user!.id));
    // Receipt writes have committed. A reporting-cache failure must not turn a
    // successful receipt into an error that encourages duplicate resubmission.
    try {
      await service.refreshMetrics(data.orderIds);
    } catch (error) {
      logger.error({ err: error, orderIds: data.orderIds }, "Receipt saved; dashboard refresh failed");
    }
    res.status(201).json({ status: true, data });
  })
);
/**
 * @swagger
 * /shipments/receipts/{orderId}:
 *   patch:
 *     summary: Edit receipt notes and/or manufacture date of a received item
 *     tags: [Shipments]
 *     parameters:
 *       - { in: path, name: orderId, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string, maxLength: 4000 }
 *               manufactureDate: { type: string, format: date, nullable: true, description: Cannot be after the receipt date }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Item not received or not found }
 */
receivingRouter.patch(
  "/:orderId",
  requirePermission("ship_edit"),
  validateRequest({
    params: z.object({ orderId: z.coerce.number().int().positive() }),
    body: receivingUpdateSchema,
  }),
  asyncHandler(async (req, res) => {
    res.json({
      status: true,
      data: await service.updateReceipt(Number(req.params.orderId), req.body, Number(req.user!.id)),
    });
  })
);
receivingRouter.post(
  "/:orderId/cancel",
  requirePermission("ship_edit"),
  validateRequest({ params: z.object({ orderId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const data = await service.cancel(Number(req.params.orderId), Number(req.user!.id));
    try {
      await service.refreshMetrics([data.orderId]);
    } catch (error) {
      logger.error({ err: error, orderId: data.orderId }, "Receipt cancelled; dashboard refresh failed");
    }
    res.json({ status: true, data });
  })
);
