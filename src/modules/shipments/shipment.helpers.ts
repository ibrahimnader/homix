import moment from "moment-timezone";

import {
  SHIPMENT_PRIORITY_KEYS,
  SHIPMENT_FINAL_STATUSES,
  SHIPMENT_PRIORITY,
  SHIPMENT_PRIORITY_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TYPE_LABELS,
} from "./shipment.constants";

type PlainRecord = Record<string, unknown>;
type Plainable = PlainRecord | { toJSON: () => PlainRecord };

export const toPlain = (value: unknown): PlainRecord => {
  if (!value || typeof value !== "object") {
    return {};
  }

  const plainableValue = value as Plainable;
  if ("toJSON" in plainableValue && typeof plainableValue.toJSON === "function") {
    return plainableValue.toJSON();
  }

  return value as PlainRecord;
};

export const toNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
  }

  return 0;
};

export const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsedValue = toNumber(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

export const toText = (value: unknown, fallback = ""): string => {
  return typeof value === "string" ? value : fallback;
};

export const toIsoString = (value: unknown): string | null => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const isValidDateInput = (value: unknown): boolean => {
  if (typeof value !== "string") {
    return false;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return !Number.isNaN(new Date(`${normalizedValue}T00:00:00.000Z`).getTime());
  }

  return !Number.isNaN(new Date(normalizedValue).getTime());
};

export const toDateRangeBoundary = (value: unknown, boundary: "start" | "end"): Date | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  // Shipment filters describe business calendar days in Egypt, not exact
  // instants. Convert ISO timestamps back to Cairo before choosing the day;
  // truncating their UTC date would move local midnight to the previous day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? moment.tz(normalizedValue, "YYYY-MM-DD", true, "Africa/Cairo")
    : moment(new Date(normalizedValue)).tz("Africa/Cairo");
  if (!date.isValid()) {
    return null;
  }
  return (boundary === "start" ? date.startOf("day") : date.endOf("day")).toDate();
};

export const getShipmentStatusLabel = (value: unknown): string => {
  return SHIPMENT_STATUS_LABELS[toNumber(value)] ?? "";
};

export const getShipmentTypeLabel = (value: unknown): string => {
  const normalizedValue = toText(value).trim();
  if (!normalizedValue) {
    return "";
  }

  return SHIPMENT_TYPE_LABELS[normalizedValue] ?? normalizedValue;
};

export const getShipmentPriority = (
  deliveryStatus: unknown,
  expectedDeliveryDate: unknown,
): number | null => {
  const date = expectedDeliveryDate instanceof Date ? expectedDeliveryDate : new Date(String(expectedDeliveryDate ?? ""));
  if (!Number.isNaN(date.getTime())) {
    const dueDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const almostDueDate = new Date(today);
    almostDueDate.setDate(almostDueDate.getDate() + 2);

    if (dueDate < today) {
      return SHIPMENT_PRIORITY.URGENT;
    }

    if (dueDate < almostDueDate) {
      return SHIPMENT_PRIORITY.ALMOST_DUE;
    }

    return SHIPMENT_PRIORITY.ON_SCHEDULE;
  }

  const numericDeliveryStatus = toNumber(deliveryStatus);
  if (numericDeliveryStatus === 1) {
    return SHIPMENT_PRIORITY.ON_SCHEDULE;
  }

  if (numericDeliveryStatus === 2) {
    return SHIPMENT_PRIORITY.ALMOST_DUE;
  }

  if (numericDeliveryStatus === 3) {
    return SHIPMENT_PRIORITY.URGENT;
  }

  return null;
};

export const resolveShipmentDeliveryStatus = (
  deliveryStatus: unknown,
  expectedDeliveryDate: unknown,
): number | null => {
  const derivedPriority = getShipmentPriority(undefined, expectedDeliveryDate);
  if (derivedPriority === SHIPMENT_PRIORITY.ON_SCHEDULE) {
    return 1;
  }

  if (derivedPriority === SHIPMENT_PRIORITY.ALMOST_DUE) {
    return 2;
  }

  if (derivedPriority === SHIPMENT_PRIORITY.URGENT) {
    return 3;
  }

  const numericDeliveryStatus = toNumber(deliveryStatus);
  return numericDeliveryStatus || null;
};

export const resolveShipmentPriority = (
  priority: unknown,
  deliveryStatus: unknown,
  expectedDeliveryDate: unknown,
): number => {
  const explicitPriority = toNumber(priority);
  if (SHIPMENT_PRIORITY_KEYS.includes(explicitPriority as typeof SHIPMENT_PRIORITY_KEYS[number])) {
    return explicitPriority;
  }

  return getShipmentPriority(resolveShipmentDeliveryStatus(deliveryStatus, expectedDeliveryDate), expectedDeliveryDate) ?? SHIPMENT_PRIORITY.ON_SCHEDULE;
};

export const getShipmentPriorityLabel = (priority: unknown): string => {
  return SHIPMENT_PRIORITY_LABELS[toNumber(priority)] ?? "";
};

export const getDaysBetween = (fromValue: unknown, toValue: unknown): number | null => {
  const fromIsoString = toIsoString(fromValue);
  if (!fromIsoString) {
    return null;
  }

  const fromDate = new Date(fromIsoString);
  const toDate = toValue ? new Date(String(toValue)) : new Date();
  if (Number.isNaN(toDate.getTime())) {
    return null;
  }

  const difference = toDate.getTime() - fromDate.getTime();
  return difference < 0 ? 0 : Math.floor(difference / (24 * 60 * 60 * 1000));
};

export const getShipmentAgingDays = (
  status: unknown,
  shippingReceiveDate: unknown,
  deliveryDate: unknown,
  updatedAt: unknown,
): number | null => {
  const numericStatus = toNumber(status);
  const endDate = SHIPMENT_FINAL_STATUSES.some((finalStatus) => finalStatus === numericStatus)
    ? (deliveryDate ?? updatedAt)
    : undefined;
  return getDaysBetween(shippingReceiveDate, endDate);
};

export const normalizeOperationCode = (value: unknown): string => {
  return toText(value).trim();
};

export const SHIPMENT_NUMBER_PREFIX = "SH";

/**
 * A shipment is always the shipping side of one order, so its number is simply
 * the order number prefixed with SH (e.g. order 10587 -> SH10587).
 */
export const buildShipmentNumber = (order: unknown): string => {
  const plainOrder = toPlain(order);
  const orderNumber = toText(
    plainOrder.orderNumber,
    toText(plainOrder.number, toText(plainOrder.name)),
  ).trim().replace(/^#/, "");

  return orderNumber ? `${SHIPMENT_NUMBER_PREFIX}${orderNumber}` : "";
};

export const buildUserName = (value: unknown): string => {
  const plainUser = toPlain(value);
  return `${toText(plainUser.firstName)} ${toText(plainUser.lastName)}`.trim();
};

export const getVariantBySku = (variantsValue: unknown, sku: string): PlainRecord | null => {
  if (!Array.isArray(variantsValue)) {
    return null;
  }

  const normalizedSku = sku.trim().toLowerCase();
  for (const variant of variantsValue) {
    const plainVariant = toPlain(variant);
    if (toText(plainVariant.sku).trim().toLowerCase() === normalizedSku) {
      return plainVariant;
    }
  }

  return null;
};
