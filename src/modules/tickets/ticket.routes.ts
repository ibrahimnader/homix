import express from "express";

import { asyncHandler, validateRequest } from "../../shared/http";
import { TicketController } from "./ticket.controller";
import { TICKET_STATUS } from "./ticket.constants";
import { TicketRepository } from "./ticket.repo";
import {
  ticketAttachmentParamsSchema,
  ticketCreateSchema,
  ticketExportQuerySchema,
  ticketIdParamsSchema,
  ticketListQuerySchema,
  ticketOperationLookupQuerySchema,
  ticketOrderNumberLookupQuerySchema,
  ticketNoteParamsSchema,
  ticketNoteSchema,
  ticketSettingsSchema,
  ticketUpdateSchema,
} from "./ticket.schemas";
import { TicketService } from "./ticket.service";

const verifyToken = require("../../../app/middlewares/protectApi");
const isNotVendor = require("../../../app/middlewares/isNotVendor");
const requirePermission = require("../../../app/middlewares/requirePermission");
const fileUploadMiddleware = require("../../../config/fileUploadMiddleware");

const ticketRepository = new TicketRepository();
const ticketService = new TicketService(ticketRepository);
const ticketController = new TicketController(ticketService);

export const ticketRouter = express.Router();

ticketRouter.use(verifyToken, isNotVendor);

const requireTicketWritePermission: express.RequestHandler = (request, response, next) => {
  const user = request.user as { permissions?: Record<string, boolean>; userType?: string } | undefined;
  if (user?.userType === "1" || user?.permissions?.tickets_reply) {
    return next();
  }

  return response.status(403).json({
    status: false,
    message: "Unauthorized",
  });
};

const requireTicketUpdatePermission: express.RequestHandler = (request, response, next) => {
  const user = request.user as { permissions?: Record<string, boolean>; userType?: string } | undefined;
  if (user?.userType === "1") {
    return next();
  }

  const nextStatus = Number((request.body as { status?: unknown })?.status);
  if (nextStatus === TICKET_STATUS.CLOSED) {
    if (user?.permissions?.tickets_close) {
      return next();
    }
  } else if (user?.permissions?.tickets_reply) {
    return next();
  }

  return response.status(403).json({
    status: false,
    message: "Unauthorized",
  });
};

/**
 * @swagger
 * /tickets/meta:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Get ticket metadata
 *     description: Returns the filter options used by the tickets page, including assignees, statuses, and ticket types.
 *     responses:
 *       200:
 *         description: Ticket metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketMetaResponse'
 *             examples:
 *               default:
 *                 value:
 *                   status: true
 *                   data:
 *                     assignees:
 *                       - id: 5
 *                         firstName: Ahmed
 *                         lastName: Hesham
 *                       - id: 8
 *                         firstName: Mona
 *                         lastName: Adel
 *                     statuses:
 *                       - key: 1
 *                         label: مفتوحة
 *                       - key: 2
 *                         label: مغلقة
 *                     types:
 *                       - key: 1
 *                         label: تأخير في التوصيل
 *                       - key: 3
 *                         label: استرجاع الأموال
 *                       - key: 7
 *                         label: صيانة
 *       401:
 *         description: Missing or invalid bearer token
 */
ticketRouter.get("/meta", requirePermission("tickets_view"), asyncHandler(ticketController.getMeta));
ticketRouter.put(
  "/settings",
  requireTicketWritePermission,
  validateRequest({ body: ticketSettingsSchema }),
  asyncHandler(ticketController.updateSettings),
);

/**
 * @swagger
 * /tickets/orders/lookup/operation-number:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Lookup order by operation number
 *     description: Fetches the order information used to prefill a new ticket.
 *     parameters:
 *       - in: query
 *         name: operationNumber
 *         required: true
 *         schema:
 *           type: string
 *           example: "3001"
 *     responses:
 *       200:
 *         description: Order lookup result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketLookupResponse'
 *             examples:
 *               found:
 *                 value:
 *                   status: true
 *                   data:
 *                     id: 12
 *                     orderNumber: "31668"
 *                     operationNumber: "3001"
 *                     customerName: Lamiaa Saeid
 *                     sellerName: ركنة للأثاث
 *                     productName: غرفة نوم - دريسينج
 *                     productSku: RKA-001
 *       404:
 *         description: Order not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               notFound:
 *                 value:
 *                   status: false
 *                   statusCode: 404
 *                   message: Order not found
 */
ticketRouter.get(
  "/orders/lookup/operation-number",
  requirePermission("tickets_view"),
  validateRequest({ query: ticketOperationLookupQuerySchema }),
  asyncHandler(ticketController.lookupOrderByOperationNumber),
);

/**
 * @swagger
 * /tickets/orders/lookup/order-number:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Lookup order by order number
 *     description: Fetches the order information used to prefill a new ticket when the search is based on the order number.
 *     parameters:
 *       - in: query
 *         name: orderNumber
 *         required: true
 *         schema:
 *           type: string
 *           example: "31668"
 *     responses:
 *       200:
 *         description: Order lookup result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketLookupResponse'
 *             examples:
 *               found:
 *                 value:
 *                   status: true
 *                   data:
 *                     id: 12
 *                     orderNumber: "31668"
 *                     operationNumber: "3001"
 *                     customerName: Lamiaa Saeid
 *                     sellerName: ركنة للأثاث
 *                     productName: غرفة نوم - دريسينج
 *                     productSku: RKA-001
 *       404:
 *         description: Order not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               notFound:
 *                 value:
 *                   status: false
 *                   statusCode: 404
 *                   message: Order not found
 */
ticketRouter.get(
  "/orders/lookup/order-number",
  requirePermission("tickets_view"),
  validateRequest({ query: ticketOrderNumberLookupQuerySchema }),
  asyncHandler(ticketController.lookupOrderByOrderNumber),
);

/**
 * @swagger
 * /tickets:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: List tickets
 *     description: Returns a paginated list of tickets with summary counters for the current filter set.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, example: 1 }
 *       - in: query
 *         name: size
 *         schema: { type: integer, default: 20, maximum: 100, example: 20 }
 *       - in: query
 *         name: assignedToUserId
 *         schema: { type: integer, example: 5 }
 *       - in: query
 *         name: operationNumber
 *         schema: { type: string, example: "3001" }
 *       - in: query
 *         name: orderNumber
 *         schema: { type: string, example: "31668" }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date, example: "2026-05-01" }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date, example: "2026-05-10" }
 *       - in: query
 *         name: status
 *         schema: { type: integer, enum: [1, 2], example: 1 }
 *       - in: query
 *         name: type
 *         schema: { type: integer, enum: [1, 2, 3, 4, 5, 6, 7, 8, 9], example: 1 }
 *     responses:
 *       200:
 *         description: Ticket list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketListResponse'
 *             examples:
 *               default:
 *                 value:
 *                   status: true
 *                   data:
 *                     items:
 *                       - id: 4
 *                         type: 1
 *                         typeLabel: تأخير في التوصيل
 *                         status: 1
 *                         statusLabel: مفتوحة
 *                         notes: تم التواصل مع شركة الشحن
 *                         creatorReply: متى بالظبط؟
 *                         assigneeReply: التوصيل خلال 72 ساعة
 *                         daysOpen: 2
 *                         createdAt: 2026-05-03T22:33:00.000Z
 *                         closedAt: null
 *                         assignedTo:
 *                           id: 5
 *                           firstName: Ahmed
 *                           lastName: Hesham
 *                         order:
 *                           id: 12
 *                           orderNumber: "31668"
 *                           operationNumber: "3001"
 *                           customerName: Lamiaa Saeid
 *                           sellerName: ركنة للأثاث
 *                           productName: غرفة نوم - دريسينج
 *                           productSku: RKA-001
 *                     page: 1
 *                     size: 20
 *                     totalCount: 1
 *                     summary:
 *                       total: 1
 *                       open: 1
 *                       closed: 0
 *                       overdueOpen: 0
 *                       averageResolutionDays: 0
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Create ticket
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TicketMutationRequest'
 *           examples:
 *             deliveryDelay:
 *               value:
 *                 orderId: 12
 *                 type: 1
 *                 assignedToUserId: 5
 *                 notes: العميل طلب تحديثًا عاجلًا عن موعد التسليم
 *     responses:
 *       201:
 *         description: Ticket created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketDetailsResponse'
 *             examples:
 *               created:
 *                 value:
 *                   status: true
 *                   data:
 *                     id: 4
 *                     type: 1
 *                     typeLabel: تأخير في التوصيل
 *                     status: 1
 *                     statusLabel: مفتوحة
 *                     notes: العميل طلب تحديثًا عاجلًا عن موعد التسليم
 *                     creatorReply: ""
 *                     assigneeReply: ""
 *                     daysOpen: 0
 *                     createdAt: 2026-05-03T22:33:00.000Z
 *                     closedAt: null
 *                     assignedTo:
 *                       id: 5
 *                       firstName: Ahmed
 *                       lastName: Hesham
 *                     createdBy:
 *                       id: 14
 *                       firstName: Sara
 *                       lastName: Mohamed
 *                     order:
 *                       id: 12
 *                       orderNumber: "31668"
 *                       operationNumber: "3001"
 *                       customerName: Lamiaa Saeid
 *                       sellerName: ركنة للأثاث
 *                       productName: غرفة نوم - دريسينج
 *                       productSku: RKA-001
 *                     attachments: []
 *                     notesList: []
 *       404:
 *         description: Related order or assignee not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
ticketRouter.get(
  "/",
  requirePermission("tickets_view"),
  validateRequest({ query: ticketListQuerySchema }),
  asyncHandler(ticketController.listTickets),
);

ticketRouter.post(
  "/",
  requireTicketWritePermission,
  validateRequest({ body: ticketCreateSchema }),
  asyncHandler(ticketController.createTicket),
);

ticketRouter.get(
  "/export",
  requirePermission("tickets_view"),
  validateRequest({ query: ticketExportQuerySchema }),
  asyncHandler(ticketController.exportTickets),
);

/**
 * @swagger
 * /tickets/{ticketId}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Get ticket details
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: integer, example: 4 }
 *     responses:
 *       200:
 *         description: Ticket details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketDetailsResponse'
 *             examples:
 *               default:
 *                 value:
 *                   status: true
 *                   data:
 *                     id: 4
 *                     type: 1
 *                     typeLabel: تأخير في التوصيل
 *                     status: 1
 *                     statusLabel: مفتوحة
 *                     notes: تم التواصل مع شركة الشحن
 *                     creatorReply: متى بالظبط؟
 *                     assigneeReply: التوصيل خلال 72 ساعة
 *                     daysOpen: 2
 *                     createdAt: 2026-05-03T22:33:00.000Z
 *                     closedAt: null
 *                     assignedTo:
 *                       id: 5
 *                       firstName: Ahmed
 *                       lastName: Hesham
 *                     createdBy:
 *                       id: 14
 *                       firstName: Sara
 *                       lastName: Mohamed
 *                     order:
 *                       id: 12
 *                       orderNumber: "31668"
 *                       operationNumber: "3001"
 *                       customerName: Lamiaa Saeid
 *                       sellerName: ركنة للأثاث
 *                       productName: غرفة نوم - دريسينج
 *                       productSku: RKA-001
 *                     attachments:
 *                       - id: 11
 *                         name: proof.png
 *                         url: uploads/ticket/proof.png
 *                         description: Screenshot
 *                         createdAt: 2026-05-03T22:33:00.000Z
 *                     history:
 *                       - id: 88
 *                         changedAt: 2026-05-03T22:33:00.000Z
 *                         eventType: ticket_created
 *                         field: ticket_created
 *                         fromValue: ""
 *                         toValue: "1"
 *                         message: تم إنشاء التذكرة
 *                         description: بواسطة Ahmed Hesham
 *                         user:
 *                           id: 1
 *                           firstName: Ahmed
 *                           lastName: Hesham
 *                     notesList:
 *                       - id: 22
 *                         text: تم فتح التذكرة بنجاح
 *                         createdAt: 2026-05-03T22:33:00.000Z
 *                         updatedAt: 2026-05-03T22:33:00.000Z
 *                         user:
 *                           id: 14
 *                           firstName: Sara
 *                           lastName: Mohamed
 *       404:
 *         description: Ticket not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   patch:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Update ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: integer, example: 4 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TicketUpdateRequest'
 *           examples:
 *             closeTicket:
 *               value:
 *                 status: 2
 *                 assignedToUserId: 8
 *                 notes: تم حل المشكلة وإغلاق التذكرة
 *     responses:
 *       200:
 *         description: Ticket updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketDetailsResponse'
 *             examples:
 *               updated:
 *                 value:
 *                   status: true
 *                   data:
 *                     id: 4
 *                     type: 1
 *                     typeLabel: تأخير في التوصيل
 *                     status: 2
 *                     statusLabel: مغلقة
 *                     notes: تم حل المشكلة وإغلاق التذكرة
 *                     creatorReply: متى بالظبط؟
 *                     assigneeReply: التوصيل خلال 72 ساعة
 *                     daysOpen: 3
 *                     createdAt: 2026-05-03T22:33:00.000Z
 *                     closedAt: 2026-05-06T10:00:00.000Z
 *                     assignedTo:
 *                       id: 8
 *                       firstName: Mona
 *                       lastName: Adel
 *                     createdBy:
 *                       id: 14
 *                       firstName: Sara
 *                       lastName: Mohamed
 *                     order:
 *                       id: 12
 *                       orderNumber: "31668"
 *                       operationNumber: "3001"
 *                       customerName: Lamiaa Saeid
 *                       sellerName: ركنة للأثاث
 *                       productName: غرفة نوم - دريسينج
 *                       productSku: RKA-001
 *                     attachments: []
 *                     history: []
 *                     notesList: []
 *       404:
 *         description: Ticket or assignee not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
ticketRouter.get(
  "/:ticketId",
  requirePermission("tickets_view"),
  validateRequest({ params: ticketIdParamsSchema }),
  asyncHandler(ticketController.getTicketById),
);

ticketRouter.patch(
  "/:ticketId",
  requireTicketUpdatePermission,
  validateRequest({ body: ticketUpdateSchema, params: ticketIdParamsSchema }),
  asyncHandler(ticketController.updateTicket),
);

ticketRouter.delete(
  "/:ticketId",
  requirePermission("tickets_close"),
  validateRequest({ params: ticketIdParamsSchema }),
  asyncHandler(ticketController.deleteTicket),
);

/**
 * @swagger
 * /tickets/{ticketId}/notes:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Add a ticket note
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: integer, example: 4 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TicketNoteRequest'
 *           examples:
 *             addNote:
 *               value:
 *                 text: تم إرسال رقم الشحنة للعميل
 *     responses:
 *       201:
 *         description: Note created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketNoteResponse'
 *             examples:
 *               created:
 *                 value:
 *                   status: true
 *                   data:
 *                     id: 22
 *                     text: تم إرسال رقم الشحنة للعميل
 *                     createdAt: 2026-05-03T22:33:00.000Z
 *                     updatedAt: 2026-05-03T22:33:00.000Z
 *                     user:
 *                       id: 14
 *                       firstName: Sara
 *                       lastName: Mohamed
 *       404:
 *         description: Ticket not found
 */
ticketRouter.post(
  "/:ticketId/notes",
  requireTicketWritePermission,
  validateRequest({ body: ticketNoteSchema, params: ticketIdParamsSchema }),
  asyncHandler(ticketController.addNote),
);

/**
 * @swagger
 * /tickets/{ticketId}/notes/{noteId}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Update a ticket note
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: integer, example: 4 }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: integer, example: 22 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TicketNoteRequest'
 *           examples:
 *             updateNote:
 *               value:
 *                 text: تم تحديث العميل بموعد التسليم الجديد
 *     responses:
 *       200:
 *         description: Note updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketNoteResponse'
 *             examples:
 *               updated:
 *                 value:
 *                   status: true
 *                   data:
 *                     id: 22
 *                     text: تم تحديث العميل بموعد التسليم الجديد
 *                     createdAt: 2026-05-03T22:33:00.000Z
 *                     updatedAt: 2026-05-04T09:15:00.000Z
 *                     user:
 *                       id: 14
 *                       firstName: Sara
 *                       lastName: Mohamed
 *       404:
 *         description: Ticket or note not found
 */
ticketRouter.put(
  "/:ticketId/notes/:noteId",
  requireTicketWritePermission,
  validateRequest({ body: ticketNoteSchema, params: ticketNoteParamsSchema }),
  asyncHandler(ticketController.updateNote),
);

/**
 * @swagger
 * /tickets/{ticketId}/notes/{noteId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Delete a ticket note
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: integer, example: 4 }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: integer, example: 22 }
 *     responses:
 *       200:
 *         description: Note deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketMessageResponse'
 *             examples:
 *               deleted:
 *                 value:
 *                   status: true
 *                   data:
 *                     message: Note deleted successfully
 *       404:
 *         description: Ticket or note not found
 */
ticketRouter.delete(
  "/:ticketId/notes/:noteId",
  requireTicketWritePermission,
  validateRequest({ params: ticketNoteParamsSchema }),
  asyncHandler(ticketController.deleteNote),
);

/**
 * @swagger
 * /tickets/{ticketId}/attachments/upload:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Upload ticket attachments
 *     description: Accepts multipart form data. Use the `files` field for one or more image or PDF files and optional `descriptions` fields aligned by index.
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: integer, example: 4 }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               descriptions:
 *                 type: array
 *                 items:
 *                   type: string
 *           encoding:
 *             files:
 *               style: form
 *             descriptions:
 *               style: form
 *           examples:
 *             upload:
 *               value:
 *                 descriptions:
 *                   - Screenshot of shipping status
 *                   - Customer invoice PDF
 *     responses:
 *       201:
 *         description: Attachments uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketAttachmentListResponse'
 *             examples:
 *               created:
 *                 value:
 *                   status: true
 *                   data:
 *                     - id: 11
 *                       name: proof.png
 *                       url: uploads/ticket/proof.png
 *                       description: Screenshot of shipping status
 *                       createdAt: 2026-05-03T22:33:00.000Z
 *                     - id: 12
 *                       name: invoice.pdf
 *                       url: uploads/ticket/invoice.pdf
 *                       description: Customer invoice PDF
 *                       createdAt: 2026-05-03T22:33:10.000Z
 *       404:
 *         description: Ticket not found
 *       409:
 *         description: No files uploaded
 */
ticketRouter.post(
  "/:ticketId/attachments/upload",
  requireTicketWritePermission,
  validateRequest({ params: ticketIdParamsSchema }),
  fileUploadMiddleware("ticket"),
  asyncHandler(ticketController.addAttachments),
);

/**
 * @swagger
 * /tickets/{ticketId}/attachments/{attachmentId}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags: [Tickets]
 *     summary: Delete a ticket attachment
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: integer, example: 4 }
 *       - in: path
 *         name: attachmentId
 *         required: true
 *         schema: { type: integer, example: 11 }
 *     responses:
 *       200:
 *         description: Attachment deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketMessageResponse'
 *             examples:
 *               deleted:
 *                 value:
 *                   status: true
 *                   data:
 *                     message: Attachment deleted successfully
 *       404:
 *         description: Ticket or attachment not found
 */
ticketRouter.delete(
  "/:ticketId/attachments/:attachmentId",
  requireTicketWritePermission,
  validateRequest({ params: ticketAttachmentParamsSchema }),
  asyncHandler(ticketController.deleteAttachment),
);
