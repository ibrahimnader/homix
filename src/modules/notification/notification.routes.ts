import express from "express";

import { asyncHandler, validateRequest } from "../../shared/http";
import { NotificationController } from "./notification.controller";
import { NotificationRepository } from "./notification.repo";
import {
  emptyNotificationPayloadSchema,
  markNotificationsReadBodySchema,
  notificationIdParamsSchema,
  notificationListQuerySchema,
} from "./notification.schemas";
import { NotificationService } from "./notification.service";

const verifyToken = require("../../../app/middlewares/protectApi");
const requirePermission = require("../../../app/middlewares/requirePermission");

const notificationRepository = new NotificationRepository();
const notificationService = new NotificationService(notificationRepository);
const notificationController = new NotificationController(notificationService);

export const notificationRouter = express.Router();

/**
 * @swagger
 * /notifications:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Notifications
 *     summary: Get current user's notifications
 *     description: Returns only the authenticated user's own notifications, newest first. Every item carries a category (orders, shipments or tickets) and the response carries unread counts per category.
 *     parameters:
 *       - in: query
 *         name: category
 *         required: false
 *         description: Return only this category. The counts always cover all categories.
 *         schema:
 *           type: string
 *           enum: [orders, shipments, tickets]
 *     responses:
 *       200:
 *         description: Notification list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationListResponse'
 *             examples:
 *               default:
 *                 value:
 *                   notifications:
 *                     - id: 17
 *                       text: تم اضافة طلب جديد رقم 31668
 *                       entityType: order
 *                       entityId: 31668
 *                       category: orders
 *                       readAt: null
 *                       createdAt: 2026-05-02T00:45:00.000Z
 *                   counts:
 *                     orders: 1
 *                     shipments: 0
 *                     tickets: 0
 *                     total: 1
 *                   status: true
 *       401:
 *         description: Missing or invalid bearer token
 */
notificationRouter.get(
  "/",
  verifyToken,
  requirePermission("notifications_view"),
  validateRequest({ query: notificationListQuerySchema }),
  asyncHandler(notificationController.getNotifications),
);

/**
 * @swagger
 * /notifications:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Notifications
 *     summary: Clear current user's notifications
 *     description: Deletes all notifications for the authenticated user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmptyObject'
 *           examples:
 *             empty:
 *               value: {}
 *     responses:
 *       200:
 *         description: Notifications removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *             examples:
 *               cleared:
 *                 value:
 *                   message: Notifications cleared successfully
 *                   status: true
 *                   statusCode: 200
 *       401:
 *         description: Missing or invalid bearer token
 */
notificationRouter.delete(
  "/",
  verifyToken,
  requirePermission("notifications_manage"),
  validateRequest({ body: emptyNotificationPayloadSchema }),
  asyncHandler(notificationController.clearNotifications),
);

/**
 * @swagger
 * /notifications:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Notifications
 *     summary: Mark all notifications as read
 *     description: Marks the authenticated user's unread notifications as read. Send an empty body for all of them, or a category to mark only that tab. Idempotent, answers 200 with updated 0 when nothing was unread.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [orders, shipments, tickets]
 *           examples:
 *             empty:
 *               value: {}
 *             tickets:
 *               value:
 *                 category: tickets
 *     responses:
 *       200:
 *         description: Notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *             examples:
 *               updated:
 *                 value:
 *                   message: Notifications marked as read successfully
 *                   status: true
 *                   statusCode: 200
 *       401:
 *         description: Missing or invalid bearer token
 */
notificationRouter.put(
  "/",
  verifyToken,
  requirePermission("notifications_manage"),
  validateRequest({ body: markNotificationsReadBodySchema }),
  asyncHandler(notificationController.markAsRead),
);

/**
 * @swagger
 * /notifications/{notificationId}/read:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Notifications
 *     summary: Mark one notification as read
 *     description: Marks a single notification of the authenticated user as read. Idempotent. A notification that belongs to someone else is reported as not found.
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Notification not found for this user
 */
notificationRouter.put(
  "/:notificationId/read",
  verifyToken,
  requirePermission("notifications_manage"),
  validateRequest({ params: notificationIdParamsSchema }),
  asyncHandler(notificationController.markOneAsRead),
);
