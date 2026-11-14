import { logger } from "../../shared/logger/logger";
import {
  dropActorAndDuplicates,
  publishNotificationsSafely,
  resolveOrderAudience,
} from "../notification/notification.publisher";
import type { NotificationRow } from "../notification/notification.publisher";
import { SHIPMENT_STATUS_LABELS } from "./shipment.constants";
import { buildShipmentNumber } from "./shipment.helpers";

/**
 * Shipment notifications (entityType "shipment", entityId = the order/shipment id; the bell shows them
 * in the "الشحنات" tab and opens /shipments/:id).
 *
 * Recipients: the same audience as the legacy ORDER notifications for that order
 * (every non-vendor user + the vendor users that own the order's products - see
 * resolveOrderAudience), minus the user who made the change (no self-notification).
 *
 * Dedupe rule: ONE shipment notification per recipient per change. A change that also changes the
 * ORDER status in the same operation (order edit / bulk edit in OrderService) already produced an
 * order notification for the very same audience, so those callers skip the shipment one
 * (`shouldNotifyShipmentStatusChange`). Shipment-side writers (shipment edit, bulk edit, returns,
 * receipts, reassignment) never send an order notification, so there the derived order/confirmation
 * changes of the status-linking sync are part of the single shipment change - not a second one.
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

    const audience = await resolveOrderAudience([...effective.keys()]);
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
    const audience = await resolveOrderAudience([orderId]);
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
