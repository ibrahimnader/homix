import { z } from "zod";

import { NOTIFICATION_CATEGORIES } from "./notification.category";

export const emptyNotificationPayloadSchema = z.object({}).passthrough();

const categorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const NOTIFICATION_DEFAULT_PAGE_SIZE = 50;
export const NOTIFICATION_MAX_PAGE_SIZE = 200;

/**
 * GET /notifications is paged (newest first). `limit` is clamped to 1..200 (default 50) instead of rejected, so an
 * old client asking for a huge page still gets a bounded answer. Next page: pass the previous response's
 * `nextCursor` back as `before` (ISO createdAt of the last item) and `beforeId` (its id, the tie-breaker).
 */
export const notificationListQuerySchema = z.object({
  before: z.coerce.date().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  category: categorySchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .optional()
    .transform((value) =>
      Math.min(NOTIFICATION_MAX_PAGE_SIZE, Math.max(1, value ?? NOTIFICATION_DEFAULT_PAGE_SIZE)),
    ),
}).passthrough();

/** PUT /notifications body: empty (everything) or `{ category }` (one tab). */
export const markNotificationsReadBodySchema = z.object({
  category: categorySchema.optional(),
}).passthrough();

export const notificationIdParamsSchema = z.object({
  notificationId: z.coerce.number().int().positive("notificationId must be a positive integer"),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/** The body of PUT / only carries a category; it has no paging fields. */
export type NotificationMarkReadBody = z.infer<typeof markNotificationsReadBodySchema>;
