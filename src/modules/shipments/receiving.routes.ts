import { Router } from "express";
import { logger } from "../../shared/logger";
import { asyncHandler, validateRequest } from "../../shared/http";
import {
  receivingCreateSchema,
  receivingDocumentSchema,
  receivingListSchema,
  receivingDocumentParams,
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
  "/",
  validateRequest({ query: receivingListSchema }),
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
