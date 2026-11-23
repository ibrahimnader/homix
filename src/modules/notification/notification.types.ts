import type { NotificationCategory, NotificationCounts } from "./notification.category";

export interface NotificationAttributes {
  /** Derived from entityType, see notification.category.ts. Not a stored column. */
  category?: NotificationCategory;
  createdAt?: Date;
  entityId: number;
  entityType: string;
  id: number;
  readAt: Date | null;
  text: string;
  updatedAt?: Date;
  userId: number | null;
}

export interface CreateNotificationInput {
  entityId: number;
  entityType: string;
  text: string;
  userId: number | null;
}

/** Keyset cursor of the next (older) page: pass `before` = createdAt and `beforeId` = id back to the API. */
export interface NotificationCursor {
  before: string;
  beforeId: number;
}

export interface NotificationPageOptions {
  /** Keyset position: only rows strictly older than (createdAt, id). */
  before?: Date;
  beforeId?: number;
  limit: number;
}

export interface NotificationResponse {
  counts: NotificationCounts;
  /** True when older notifications exist beyond this page. */
  hasMore: boolean;
  /** Cursor of the next page, null on the last page. */
  nextCursor: NotificationCursor | null;
  notifications: NotificationAttributes[];
  status: true;
}

export interface NotificationActionResponse {
  message: string;
  status: true;
  /** Rows changed by a mark-as-read call. */
  updated?: number;
}
