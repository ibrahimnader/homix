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
  bulkCreate: (payloads: CreateNotificationInput[]) => Promise<unknown>;
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

/* Loaded on first use, not at import time: the notification publisher is imported by the shipment/ticket
   services and routes, and importing them must not define the Sequelize model as a side effect. */
let cachedNotificationModel: LegacyNotificationModel | undefined;
const getNotificationModel = (): LegacyNotificationModel => {
  cachedNotificationModel ??= require("../../../app/modules/notification/notification.model") as LegacyNotificationModel;
  return cachedNotificationModel;
};

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
    const createdNotification = await getNotificationModel().create(payload);
    return toNotification(createdNotification) as TResult;
  }

  /** One INSERT for many rows (same mechanism the legacy order notifications use). */
  public async createMany(payloads: CreateNotificationInput[]): Promise<void> {
    if (payloads.length > 0) {
      await getNotificationModel().bulkCreate(payloads);
    }
  }

  public async findAll<TResult = NotificationAttributes>(
    filters: Readonly<Record<string, unknown>> = {},
  ): Promise<TResult[]> {
    const notifications = await getNotificationModel().findAll({
      order: [["createdAt", "DESC"]],
      where: filters,
    });

    return notifications.map((notification) => toNotification(notification) as TResult);
  }

  /** Unread notifications of one user, bucketed per category. */
  public async countUnreadByCategory(userId: number): Promise<NotificationCounts> {
    const rows = (await getNotificationModel().findAll({
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
    const [affectedRows] = await getNotificationModel().update(payload, { where: filters });
    return affectedRows as TResult;
  }

  public async delete<TResult = number>(
    filters: Readonly<Record<string, unknown>>,
  ): Promise<TResult> {
    const deletedRows = await getNotificationModel().destroy({ where: filters });
    return deletedRows as TResult;
  }
}
