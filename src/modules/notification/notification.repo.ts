import { col, fn, Op } from "sequelize";

import type { BaseRepository } from "../../shared/repository";
import {
  getNotificationCategory,
  SHIPMENT_ENTITY_TYPES,
  TICKET_ENTITY_TYPES,
} from "./notification.category";
import type { NotificationCategory, NotificationCounts } from "./notification.category";
import { emptyNotificationCounts } from "./notification.category";
import type {
  CreateNotificationInput,
  NotificationAttributes,
} from "./notification.types";

type LegacyNotificationModel = {
  create: (payload: CreateNotificationInput) => Promise<{ toJSON: () => NotificationAttributes }>;
  destroy: (options: { where: Readonly<Record<string, unknown>> }) => Promise<number>;
  findAll: (options: {
    attributes?: unknown;
    group?: unknown;
    order?: ReadonlyArray<readonly [string, string]>;
    raw?: boolean;
    where?: Readonly<Record<string, unknown>>;
  }) => Promise<Array<{ toJSON: () => NotificationAttributes } | NotificationAttributes>>;
  update: (
    payload: Partial<CreateNotificationInput> & { readAt?: Date | null },
    options: { where: Readonly<Record<string, unknown>> },
  ) => Promise<[number]>;
};

const notificationModel = require("../../../app/modules/notification/notification.model") as LegacyNotificationModel;

const toNotification = (
  notification: { toJSON: () => NotificationAttributes } | NotificationAttributes,
): NotificationAttributes => {
  const plain = "toJSON" in notification ? notification.toJSON() : notification;
  return { ...plain, category: getNotificationCategory(plain.entityType) };
};

/** `entityType` filter that selects exactly one category (the inverse of getNotificationCategory). */
export const buildCategoryWhere = (category: NotificationCategory): Record<string, unknown> => {
  if (category === "shipments") {
    return { entityType: { [Op.in]: [...SHIPMENT_ENTITY_TYPES] } };
  }

  if (category === "tickets") {
    return { entityType: { [Op.in]: [...TICKET_ENTITY_TYPES] } };
  }

  return { entityType: { [Op.notIn]: [...SHIPMENT_ENTITY_TYPES, ...TICKET_ENTITY_TYPES] } };
};

export class NotificationRepository
  implements BaseRepository<NotificationAttributes, CreateNotificationInput, Partial<CreateNotificationInput>>
{
  public async create<TResult = NotificationAttributes>(
    payload: CreateNotificationInput,
  ): Promise<TResult> {
    const createdNotification = await notificationModel.create(payload);
    return toNotification(createdNotification) as TResult;
  }

  public async findAll<TResult = NotificationAttributes>(
    filters: Readonly<Record<string, unknown>> = {},
  ): Promise<TResult[]> {
    const notifications = await notificationModel.findAll({
      order: [["createdAt", "DESC"]],
      where: filters,
    });

    return notifications.map((notification) => toNotification(notification) as TResult);
  }

  /** Unread notifications of one user, bucketed per category. */
  public async countUnreadByCategory(userId: number): Promise<NotificationCounts> {
    const rows = (await notificationModel.findAll({
      attributes: ["entityType", [fn("COUNT", col("id")), "count"]],
      group: ["entityType"],
      raw: true,
      where: { readAt: null, userId },
    })) as unknown as Array<{ count: number | string; entityType: string }>;

    const counts = emptyNotificationCounts();
    for (const row of rows) {
      const amount = Number(row.count) || 0;
      counts[getNotificationCategory(row.entityType)] += amount;
      counts.total += amount;
    }

    return counts;
  }

  public async update<TResult = number>(
    filters: Readonly<Record<string, unknown>>,
    payload: Partial<CreateNotificationInput> & { readAt?: Date | null },
  ): Promise<TResult> {
    const [affectedRows] = await notificationModel.update(payload, { where: filters });
    return affectedRows as TResult;
  }

  public async delete<TResult = number>(
    filters: Readonly<Record<string, unknown>>,
  ): Promise<TResult> {
    const deletedRows = await notificationModel.destroy({ where: filters });
    return deletedRows as TResult;
  }
}
