import { NotFoundError } from "../../shared/errors";
import type { Result } from "../../shared/result";
import { success } from "../../shared/result";
import type { NotificationCategory } from "./notification.category";
import { buildCategoryWhere, NotificationRepository } from "./notification.repo";
import type {
  CreateNotificationInput,
  NotificationActionResponse,
  NotificationAttributes,
  NotificationResponse,
} from "./notification.types";

export interface NotificationServiceContract {
  clearNotifications(userId: number): Promise<Result<NotificationActionResponse>>;
  createNotification(payload: CreateNotificationInput): Promise<Result<NotificationAttributes>>;
  getNotifications(userId: number, category?: NotificationCategory): Promise<Result<NotificationResponse>>;
  markAsRead(userId: number, category?: NotificationCategory): Promise<Result<NotificationActionResponse>>;
  markOneAsRead(userId: number, notificationId: number): Promise<Result<NotificationActionResponse>>;
}

const NOTIFICATIONS_CLEARED_MESSAGE = "Notifications cleared";
const NOTIFICATIONS_MARKED_AS_READ_MESSAGE = "Notifications marked as read";

export class NotificationService implements NotificationServiceContract {
  public constructor(private readonly notificationRepository: NotificationRepository) {}

  public async clearNotifications(userId: number): Promise<Result<NotificationActionResponse>> {
    const deletedRows = await this.notificationRepository.delete({ userId });

    if (deletedRows < 1) {
      throw new NotFoundError("Notifications not found");
    }

    return success({
      message: NOTIFICATIONS_CLEARED_MESSAGE,
      status: true,
    });
  }

  public async createNotification(
    payload: CreateNotificationInput,
  ): Promise<Result<NotificationAttributes>> {
    const notification = await this.notificationRepository.create(payload);
    return success(notification);
  }

  /* Every query is scoped by the authenticated user's id (never taken from the request),
     so a user - vendors included - can only ever see or change their own notifications. */
  public async getNotifications(
    userId: number,
    category?: NotificationCategory,
  ): Promise<Result<NotificationResponse>> {
    const [notifications, counts] = await Promise.all([
      this.notificationRepository.findAll(
        category ? { userId, ...buildCategoryWhere(category) } : { userId },
      ),
      this.notificationRepository.countUnreadByCategory(userId),
    ]);

    return success({
      counts,
      notifications,
      status: true,
    });
  }

  public async markAsRead(
    userId: number,
    category?: NotificationCategory,
  ): Promise<Result<NotificationActionResponse>> {
    const updatedRows = await this.notificationRepository.update(
      category ? { readAt: null, userId, ...buildCategoryWhere(category) } : { readAt: null, userId },
      { readAt: new Date() },
    );

    if (updatedRows < 1) {
      throw new NotFoundError("Unread notifications not found");
    }

    return success({
      message: NOTIFICATIONS_MARKED_AS_READ_MESSAGE,
      status: true,
    });
  }

  /** Idempotent: re-reading an already-read notification succeeds, a foreign/missing id is a 404. */
  public async markOneAsRead(
    userId: number,
    notificationId: number,
  ): Promise<Result<NotificationActionResponse>> {
    const updatedRows = await this.notificationRepository.update(
      { id: notificationId, readAt: null, userId },
      { readAt: new Date() },
    );

    if (updatedRows < 1) {
      const existing = await this.notificationRepository.findAll({ id: notificationId, userId });
      if (existing.length < 1) {
        throw new NotFoundError("Notification not found");
      }
    }

    return success({
      message: NOTIFICATIONS_MARKED_AS_READ_MESSAGE,
      status: true,
    });
  }
}
