import { Op } from "sequelize";

import { logger } from "../../shared/logger/logger";
import { NotificationRepository } from "./notification.repo";
import type { CreateNotificationInput } from "./notification.types";

/**
 * Shared "create + deliver" mechanism for new notification producers (shipments, tickets).
 *
 * It is the same mechanism the legacy order/vendor notifications use:
 *  1. one `notifications` row per recipient (`bulkCreate`, columns text/entityType/entityId/userId),
 *  2. a socket.io `notification` event to every socket id stored on the recipient (`users.socketIds`),
 *     whose payload carries `entityType` + `entityId` + `text` so the bell puts it in the right tab
 *     (category is derived from entityType, see notification.category.ts).
 *
 * Every public function here is failure-safe: a notification problem is logged and swallowed,
 * it must never fail (or roll back) the business operation that triggered it.
 */

type UserModelLike = {
  findAll: (options: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
};

/* Models are required lazily so that importing a module that merely *can* notify (shipment/ticket
   services, routes) does not pull the Sequelize models into every unit test of that module. */
const loadUserModel = (): UserModelLike =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  require("../../../app/modules/user/user.model") as UserModelLike;
const loadOrderModel = (): UserModelLike =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  require("../../../app/modules/order/order.model") as UserModelLike;
const loadOrderLineModel = (): UserModelLike =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  require("../../../app/modules/orderLines/orderline.model") as UserModelLike;
const loadProductModel = (): unknown =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  require("../../../app/modules/product/product.model");
const loadUserTypes = (): { ADMIN: string; VENDOR: string } =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  (require("../../../config/constants") as { USER_TYPES: { ADMIN: string; VENDOR: string } }).USER_TYPES;

const toPlain = (value: unknown): Record<string, unknown> => {
  const candidate = value as { toJSON?: () => Record<string, unknown> } | null | undefined;
  if (candidate && typeof candidate.toJSON === "function") {
    return candidate.toJSON();
  }
  return (candidate ?? {}) as Record<string, unknown>;
};

const toId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const uniqueIds = (values: ReadonlyArray<unknown>): number[] => [
  ...new Set(values.map(toId).filter((id): id is number => id !== null)),
];

export type NotificationRow = CreateNotificationInput & { userId: number };

/** Drops the actor (no self-notification), invalid ids and duplicates, keeping the first row per user. */
export const dropActorAndDuplicates = (
  rows: ReadonlyArray<NotificationRow>,
  actorId?: number | string | null,
): NotificationRow[] => {
  const actor = toId(actorId);
  const seen = new Set<number>();
  const result: NotificationRow[] = [];
  for (const row of rows) {
    const userId = toId(row.userId);
    if (userId === null || userId === actor || seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    result.push({ ...row, userId });
  }
  return result;
};

/**
 * Inserts the rows and pushes each one to its recipient's sockets. Throws on failure; callers use
 * `publishNotificationsSafely`. Rows must already be deduplicated (one per user per event).
 */
export const publishNotifications = async (rows: ReadonlyArray<NotificationRow>): Promise<void> => {
  if (rows.length === 0) {
    return;
  }

  await new NotificationRepository().createMany(rows.map((row) => ({ ...row })));

  const io = (global as { socketIO?: { to?: (id: string) => { emit: (event: string, payload: unknown) => void } } }).socketIO;
  if (!io || typeof io.to !== "function") {
    return;
  }

  const users = await loadUserModel().findAll({
    attributes: ["id", "socketIds"],
    where: { id: { [Op.in]: rows.map((row) => row.userId) } },
  });
  const socketIdsByUser = new Map<number, string[]>();
  for (const user of users) {
    const plain = toPlain(user);
    const socketIds = Array.isArray(plain.socketIds) ? (plain.socketIds as string[]) : [];
    socketIdsByUser.set(Number(plain.id), socketIds);
  }

  for (const row of rows) {
    for (const socketId of socketIdsByUser.get(row.userId) ?? []) {
      io.to(socketId).emit("notification", {
        entityId: row.entityId,
        entityType: row.entityType,
        text: row.text,
        userId: null,
      });
    }
  }
};

/** Same as publishNotifications but never throws: a notification failure is only logged. */
export const publishNotificationsSafely = async (
  rows: ReadonlyArray<NotificationRow>,
  context: string,
): Promise<void> => {
  try {
    await publishNotifications(rows);
  } catch (error) {
    logger.error({ context, err: error }, "Failed to publish notifications");
  }
};

export type OrderAudience = {
  /** orderNumber per order id (empty string when the order has none). */
  orderNumbers: Map<number, string>;
  /** For every notified user, the ids (subset of the requested ones) of the orders that user may see. */
  ordersByUser: Map<number, number[]>;
  /** The subset of `ordersByUser` keys that are vendor users. */
  vendorUserIds: Set<number>;
};

/**
 * Who receives notifications about an order: exactly the legacy ORDER notification audience
 * (OrderService.sendNotification) - every non-vendor user, plus vendor users whose vendorId owns
 * a product on one of the order's lines. A vendor therefore only ever gets their own orders.
 */
export const resolveOrderAudience = async (orderIds: ReadonlyArray<number>): Promise<OrderAudience> => {
  const ids = uniqueIds(orderIds);
  const audience: OrderAudience = { orderNumbers: new Map(), ordersByUser: new Map(), vendorUserIds: new Set() };
  if (ids.length === 0) {
    return audience;
  }

  const USER_TYPES = loadUserTypes();
  const [orders, lines, users] = await Promise.all([
    loadOrderModel().findAll({ attributes: ["id", "orderNumber"], where: { id: { [Op.in]: ids } } }),
    loadOrderLineModel().findAll({
      attributes: ["orderId"],
      include: [{ as: "product", attributes: ["vendorId"], model: loadProductModel(), required: true }],
      where: { orderId: { [Op.in]: ids } },
    }),
    loadUserModel().findAll({
      attributes: ["id", "userType", "vendorId"],
      where: { [Op.or]: [{ userType: { [Op.ne]: USER_TYPES.VENDOR } }, { vendorId: { [Op.ne]: null } }] },
    }),
  ]);

  for (const order of orders) {
    const plain = toPlain(order);
    audience.orderNumbers.set(Number(plain.id), String(plain.orderNumber ?? "").trim());
  }

  const vendorsByOrder = new Map<number, Set<number>>();
  for (const line of lines) {
    const plain = toPlain(line);
    const vendorId = toId(toPlain(plain.product).vendorId);
    const orderId = toId(plain.orderId);
    if (vendorId === null || orderId === null) {
      continue;
    }
    vendorsByOrder.set(orderId, (vendorsByOrder.get(orderId) ?? new Set<number>()).add(vendorId));
  }

  for (const user of users) {
    const plain = toPlain(user);
    const userId = toId(plain.id);
    if (userId === null) {
      continue;
    }
    const visible = String(plain.userType) !== USER_TYPES.VENDOR
      ? ids
      : ids.filter((orderId) => {
        const vendorId = toId(plain.vendorId);
        return vendorId !== null && vendorsByOrder.get(orderId)?.has(vendorId) === true;
      });
    if (visible.length > 0) {
      audience.ordersByUser.set(userId, visible);
      if (String(plain.userType) === USER_TYPES.VENDOR) {
        audience.vendorUserIds.add(userId);
      }
    }
  }

  return audience;
};

/** Vendor users (users.vendorId) of the vendors that own the order's products. */
export const resolveOrderVendorUserIds = async (orderId: number): Promise<number[]> =>
  [...(await resolveOrderAudience([orderId])).vendorUserIds];

/** Admin users (USER_TYPES.ADMIN). */
export const resolveAdminUserIds = async (): Promise<number[]> => {
  const users = await loadUserModel().findAll({
    attributes: ["id"],
    where: { userType: loadUserTypes().ADMIN },
  });
  return uniqueIds(users.map((user) => toPlain(user).id));
};
