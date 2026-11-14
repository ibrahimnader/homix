/**
 * Notification categories (the three tabs of the notification center).
 *
 * The category is derived from `entityType` at read time instead of being stored:
 * `entityType` is NOT NULL and already identifies the thing the notification is about,
 * so a stored column would only duplicate it (and need a backfill). Anything that is not
 * a shipment or a ticket (orders, order lines, vendors, ...) belongs to "orders".
 */
export const NOTIFICATION_CATEGORIES = ["orders", "shipments", "tickets"] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const SHIPMENT_ENTITY_TYPES: readonly string[] = ["shipment", "shipments"];
export const TICKET_ENTITY_TYPES: readonly string[] = ["ticket", "tickets"];

export const getNotificationCategory = (entityType: string | null | undefined): NotificationCategory => {
  const normalized = String(entityType ?? "").trim().toLowerCase();

  if (SHIPMENT_ENTITY_TYPES.includes(normalized)) {
    return "shipments";
  }

  if (TICKET_ENTITY_TYPES.includes(normalized)) {
    return "tickets";
  }

  return "orders";
};

export interface NotificationCounts {
  orders: number;
  shipments: number;
  tickets: number;
  total: number;
}

export const emptyNotificationCounts = (): NotificationCounts => ({
  orders: 0,
  shipments: 0,
  tickets: 0,
  total: 0,
});
