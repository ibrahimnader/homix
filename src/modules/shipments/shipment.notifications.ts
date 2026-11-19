import { logger } from "../../shared/logger/logger";
import {
  dropActorAndDuplicates,
  publishNotificationsSafely,
  resolveShipmentAudience,
} from "../notification/notification.publisher";
import type { NotificationRow } from "../notification/notification.publisher";
import { SHIPMENT_SCHEDULE_STATUS_LABELS, SHIPMENT_STATUS_LABELS } from "./shipment.constants";
import { buildShipmentNumber } from "./shipment.helpers";

/**
 * Shipment notifications (entityType "shipment", entityId = the order/shipment id; the bell shows them
 * in the "الشحنات" tab and opens /shipments/:id).
 *
 * Recipients: the order's responsible user (orders.userId) + every admin + the vendor users that own the
 * order's products (see resolveShipmentAudience; an order with no responsible user reaches admins and its
 * vendors only), minus the user who made the change (no self-notification). The legacy ORDER notifications
 * keep their own, wider audience.
 *
 * Dedupe rule: ONE shipment notification per recipient per change. A change that also changes the
 * ORDER status in the same operation (order edit / bulk edit in OrderService) already produced an
 * order notification (whose audience covers this one), so those callers skip the shipment one
 * (`shouldNotifyShipmentStatusChange`). Shipment-side writers (shipment edit, bulk edit, returns,
 * receipts, reassignment) never send an order notification, so there the derived order/confirmation
 * changes of the status-linking sync are part of the single shipment change - not a second one.
 *
 * Schedule status (حالة الجدولة, orders.scheduleStatus): its own notification ("تم تغيير حالة جدولة الشحنة #… إلى …",
 * or "تم إلغاء حالة جدولة الشحنة #…" when cleared), same audience. De-dup per operation and shipment: a changed
 * shipment status wins (its notification is the only one; callers skip the schedule-status one); otherwise a changed
 * schedule status wins over the scheduled-date notification and mentions the date ("... بتاريخ YYYY-MM-DD") when
 * the date changed in the same operation.
 *
 * Bulk: a recipient who sees several changed shipments gets ONE aggregated notification.
 *
 * Everything here is failure-safe (never throws).
 */

export type ShipmentStatusChange = {
  orderId: number;
  /** Status before the change; changes where from === to are ignored. Unknown (undefined) is allowed. */
  fromStatus?: number | null;
  toStatus: number;
};

export const SHIPMENT_STATUS_CHANGED_PREFIX = "تم تغيير حالة الشحنة";
export const SHIPMENT_SCHEDULED_PREFIX = "تم جدولة الشحنة";
export const SHIPMENT_SCHEDULE_STATUS_CHANGED_PREFIX = "تم تغيير حالة جدولة الشحنة";
export const SHIPMENT_SCHEDULE_STATUS_CLEARED_PREFIX = "تم إلغاء حالة جدولة الشحنة";

const statusLabel = (status: number): string => SHIPMENT_STATUS_LABELS[status] ?? String(status);

const shipmentLabel = (orderId: number, orderNumber: string | undefined): string => {
  const shipmentNumber = buildShipmentNumber({ orderNumber: orderNumber ?? "" });
  return `#${shipmentNumber || orderId}`;
};

/**
 * Callers that also send the legacy ORDER notification pass whether the order status changed in the same
 * operation: in that case the order notification already reached everyone, so no shipment one is sent.
 */
export const shouldNotifyShipmentStatusChange = (
  before: { shipmentStatus?: unknown; status?: unknown },
  after: { shipmentStatus?: unknown; status?: unknown },
): boolean => {
  const shipmentChanged = Number(before.shipmentStatus ?? 0) !== Number(after.shipmentStatus ?? 0)
    && Number(after.shipmentStatus ?? 0) > 0;
  const orderStatusChanged = Number(before.status ?? 0) !== Number(after.status ?? 0);
  return shipmentChanged && !orderStatusChanged;
};

export const buildShipmentStatusText = (
  changes: ReadonlyArray<ShipmentStatusChange>,
  orderNumbers: ReadonlyMap<number, string>,
): string => {
  const [first] = changes;
  if (!first) {
    return "";
  }
  if (changes.length === 1) {
    return `${SHIPMENT_STATUS_CHANGED_PREFIX} ${shipmentLabel(first.orderId, orderNumbers.get(first.orderId))} إلى ${statusLabel(first.toStatus)}`;
  }
  const targets = new Set(changes.map((change) => change.toStatus));
  return targets.size === 1
    ? `تم تغيير حالة ${changes.length} شحنة إلى ${statusLabel(first.toStatus)}`
    : `تم تغيير حالة ${changes.length} شحنة`;
};

export const notifyShipmentStatusChanges = async (
  changes: ReadonlyArray<ShipmentStatusChange>,
  actorId?: number | string | null,
): Promise<void> => {
  try {
    const effective = new Map<number, ShipmentStatusChange>();
    for (const change of changes) {
      const orderId = Number(change.orderId);
      const toStatus = Number(change.toStatus);
      if (!Number.isInteger(orderId) || orderId < 1 || !Number.isInteger(toStatus) || toStatus < 1) {
        continue;
      }
      if (change.fromStatus !== undefined && Number(change.fromStatus ?? 0) === toStatus) {
        continue;
      }
      effective.set(orderId, { fromStatus: change.fromStatus, orderId, toStatus });
    }
    if (effective.size === 0) {
      return;
    }

    const audience = await resolveShipmentAudience([...effective.keys()]);
    const rows: NotificationRow[] = [];
    for (const [userId, orderIds] of audience.ordersByUser) {
      const userChanges = orderIds
        .map((orderId) => effective.get(orderId))
        .filter((change): change is ShipmentStatusChange => change !== undefined);
      if (userChanges.length === 0) {
        continue;
      }
      rows.push({
        /* For an aggregated notification the first shipment is the click target. */
        entityId: userChanges[0]!.orderId,
        entityType: "shipment",
        text: buildShipmentStatusText(userChanges, audience.orderNumbers),
        userId,
      });
    }

    await publishNotificationsSafely(dropActorAndDuplicates(rows, actorId), "shipment-status-changed");
  } catch (error) {
    logger.error({ err: error }, "Failed to build shipment status notifications");
  }
};

const formatDay = (value: unknown): string => {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

/** A shipment got (or changed) its scheduled delivery date without its status changing. */
export const notifyShipmentScheduled = async (
  orderId: number,
  scheduledDeliveryDate: unknown,
  actorId?: number | string | null,
): Promise<void> => {
  try {
    const day = formatDay(scheduledDeliveryDate);
    if (!day) {
      return;
    }
    const audience = await resolveShipmentAudience([orderId]);
    const text = `${SHIPMENT_SCHEDULED_PREFIX} ${shipmentLabel(orderId, audience.orderNumbers.get(orderId))} بتاريخ ${day}`;
    const rows: NotificationRow[] = [...audience.ordersByUser.keys()].map((userId) => ({
      entityId: orderId,
      entityType: "shipment",
      text,
      userId,
    }));
    await publishNotificationsSafely(dropActorAndDuplicates(rows, actorId), "shipment-scheduled");
  } catch (error) {
    logger.error({ err: error }, "Failed to build shipment schedule notifications");
  }
};

export type ShipmentScheduleStatusChange = {
  orderId: number;
  fromScheduleStatus?: number | null;
  /** null = the schedule status was cleared. */
  toScheduleStatus: number | null;
  /** Set (single edits) when the scheduled date changed in the same operation; mentioned in the text. */
  scheduledDeliveryDate?: unknown;
};

const scheduleStatusLabel = (status: number): string => SHIPMENT_SCHEDULE_STATUS_LABELS[status] ?? String(status);

/** True when the schedule status really changed (null/0/undefined all mean "no status"). */
export const hasScheduleStatusChanged = (before: unknown, after: unknown): boolean =>
  (Number(before ?? 0) || 0) !== (Number(after ?? 0) || 0);

export const buildShipmentScheduleStatusText = (
  changes: ReadonlyArray<ShipmentScheduleStatusChange>,
  orderNumbers: ReadonlyMap<number, string>,
): string => {
  const [first] = changes;
  if (!first) {
    return "";
  }
  if (changes.length === 1) {
    const label = shipmentLabel(first.orderId, orderNumbers.get(first.orderId));
    if (first.toScheduleStatus === null) {
      return `${SHIPMENT_SCHEDULE_STATUS_CLEARED_PREFIX} ${label}`;
    }
    const day = first.scheduledDeliveryDate ? formatDay(first.scheduledDeliveryDate) : "";
    return `${SHIPMENT_SCHEDULE_STATUS_CHANGED_PREFIX} ${label} إلى ${scheduleStatusLabel(first.toScheduleStatus)}${day ? ` بتاريخ ${day}` : ""}`;
  }
  const targets = new Set(changes.map((change) => change.toScheduleStatus));
  if (targets.size === 1) {
    return first.toScheduleStatus === null
      ? `تم إلغاء حالة جدولة ${changes.length} شحنة`
      : `تم تغيير حالة جدولة ${changes.length} شحنة إلى ${scheduleStatusLabel(first.toScheduleStatus)}`;
  }
  return `تم تغيير حالة جدولة ${changes.length} شحنة`;
};

/**
 * Schedule-status changes (single or bulk). Callers must NOT pass shipments whose shipment status (or order status)
 * changed in the same operation - that notification already covers them. Aggregated per recipient, never the actor.
 */
export const notifyShipmentScheduleStatusChanges = async (
  changes: ReadonlyArray<ShipmentScheduleStatusChange>,
  actorId?: number | string | null,
): Promise<void> => {
  try {
    const effective = new Map<number, ShipmentScheduleStatusChange>();
    for (const change of changes) {
      const orderId = Number(change.orderId);
      if (!Number.isInteger(orderId) || orderId < 1) {
        continue;
      }
      const to = change.toScheduleStatus === null || change.toScheduleStatus === undefined
        ? null
        : Number(change.toScheduleStatus) || null;
      if (change.fromScheduleStatus !== undefined && !hasScheduleStatusChanged(change.fromScheduleStatus, to)) {
        continue;
      }
      effective.set(orderId, { ...change, orderId, toScheduleStatus: to });
    }
    if (effective.size === 0) {
      return;
    }

    const audience = await resolveShipmentAudience([...effective.keys()]);
    const rows: NotificationRow[] = [];
    for (const [userId, orderIds] of audience.ordersByUser) {
      const userChanges = orderIds
        .map((orderId) => effective.get(orderId))
        .filter((change): change is ShipmentScheduleStatusChange => change !== undefined);
      if (userChanges.length === 0) {
        continue;
      }
      rows.push({
        entityId: userChanges[0]!.orderId,
        entityType: "shipment",
        text: buildShipmentScheduleStatusText(userChanges, audience.orderNumbers),
        userId,
      });
    }

    await publishNotificationsSafely(dropActorAndDuplicates(rows, actorId), "shipment-schedule-status-changed");
  } catch (error) {
    logger.error({ err: error }, "Failed to build shipment schedule-status notifications");
  }
};
