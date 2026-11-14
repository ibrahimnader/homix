import { z } from "zod";

import { NOTIFICATION_CATEGORIES } from "./notification.category";

export const emptyNotificationPayloadSchema = z.object({}).passthrough();

const categorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const notificationListQuerySchema = z.object({
  category: categorySchema.optional(),
}).passthrough();

/** PUT /notifications body: empty (everything) or `{ category }` (one tab). */
export const markNotificationsReadBodySchema = z.object({
  category: categorySchema.optional(),
}).passthrough();

export const notificationIdParamsSchema = z.object({
  notificationId: z.coerce.number().int().positive("notificationId must be a positive integer"),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
