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

export interface NotificationResponse {
  counts: NotificationCounts;
  notifications: NotificationAttributes[];
  status: true;
}

export interface NotificationActionResponse {
  message: string;
  status: true;
}
