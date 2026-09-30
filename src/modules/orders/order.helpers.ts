import {
  DELIVERY_BY,
  DELIVERY_BY_ARABIC,
  DELIVERY_STATUS,
  MANUFACTURE_STATUS_ARABIC,
  ORDER_SOURCE_ARABIC,
  ORDER_STATUS,
  ORDER_STATUS_Arabic,
  PAYMENT_STATUS_ARABIC,
} from "../../../config/constants";
import {
  DELIVERY_STATUS_PRIORITY_MAP,
  MANUFACTURE_STATUS_LABELS,
  ORDER_PRIORITY,
  ORDER_DELIVERY_PRIORITY,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from "./order.constants";
import {
  SHIPMENT_PRIORITY_LABELS,
  SHIPMENT_SCHEDULE_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TYPE_LABELS,
} from "../shipments/shipment.constants";
import type { OrderPriorityKey } from "./order.types";

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

export const getDeliveryStatusValue = (expectedDeliveryDate: unknown): number | null => {
  const isoString = toIsoString(expectedDeliveryDate);
  if (!isoString) {
    return null;
  }

  const dueDate = new Date(isoString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const almostDueDate = new Date(today);
  almostDueDate.setDate(almostDueDate.getDate() + 2);

  if (dueDate < today) {
    return DELIVERY_STATUS.LATE;
  }

  if (dueDate < almostDueDate) {
    return DELIVERY_STATUS.ALMOST_LAST;
  }

  return DELIVERY_STATUS.ON_SCHEDULE;
};

export const resolveDeliveryStatus = (
  deliveryStatus: unknown,
  expectedDeliveryDate: unknown,
): number | null => {
  const derivedStatus = getDeliveryStatusValue(expectedDeliveryDate);
  if (derivedStatus) {
    return derivedStatus;
  }

  const parsedStatus = toNumber(deliveryStatus);
  return parsedStatus || null;
};

export const getOrderPriority = (expectedDeliveryDate: unknown): OrderPriorityKey | null => {
  const deliveryStatus = getDeliveryStatusValue(expectedDeliveryDate);
  return deliveryStatus ? DELIVERY_STATUS_PRIORITY_MAP[deliveryStatus] ?? null : null;
};

export const resolveOrderPriority = (
  priority: unknown,
  deliveryStatus?: unknown,
  expectedDeliveryDate?: unknown,
): OrderPriorityKey => {
  const explicitPriority = toNumber(priority);
  if (explicitPriority && Object.values(ORDER_PRIORITY).includes(explicitPriority as OrderPriorityKey)) {
    return explicitPriority as OrderPriorityKey;
  }

  const derivedPriority = getOrderPriorityFromDeliveryStatus(deliveryStatus, expectedDeliveryDate);
  return derivedPriority ?? ORDER_PRIORITY.ON_SCHEDULE;
};

export const getOrderPriorityFromDeliveryStatus = (
  deliveryStatus: unknown,
  expectedDeliveryDate?: unknown,
): OrderPriorityKey | null => {
  const resolvedDeliveryStatus = resolveDeliveryStatus(deliveryStatus, expectedDeliveryDate);
  if (resolvedDeliveryStatus) {
    return DELIVERY_STATUS_PRIORITY_MAP[resolvedDeliveryStatus as keyof typeof DELIVERY_STATUS_PRIORITY_MAP] ?? null;
  }

  return null;
};

export const getDeliveryPriorityLabel = (priority: OrderPriorityKey | null): string => {
  if (priority === ORDER_DELIVERY_PRIORITY.URGENT) {
    return "مستعجل جدا";
  }

  if (priority === ORDER_DELIVERY_PRIORITY.ALMOST_DUE) {
    return "مستعجل";
  }

  if (priority === ORDER_DELIVERY_PRIORITY.ON_SCHEDULE) {
    return "بالمدة";
  }

  return "";
};

export const getDaysSince = (value: unknown): number | null => {
  const isoString = toIsoString(value);
  if (!isoString) {
    return null;
  }

  const date = new Date(isoString);
  const difference = Date.now() - date.getTime();
  return difference < 0 ? 0 : Math.floor(difference / (24 * 60 * 60 * 1000));
};

export const getStatusLabel = (value: unknown): string => {
  return ORDER_STATUS_LABELS[toNumber(value)] ?? "";
};

export const getPaymentLabel = (value: unknown): string => {
  return PAYMENT_STATUS_LABELS[toNumber(value)] ?? "";
};

export const getManufactureLabel = (value: unknown): string => {
  return MANUFACTURE_STATUS_LABELS[toNumber(value)] ?? "";
};

const FIELD_LABELS: Record<string, string> = {
  deliveryBy: "التوصيل بواسطة",
  deliveryDate: "تاريخ التسليم",
  deliveryStatus: "حالة التسليم",
  downPayment: "جدية الشراء",
  expectedDeliveryDate: "موعد التسليم المتوقع",
  governorate: "المحافظة",
  manufactureStatus: "حالة التصنيع",
  notes: "الملاحظات",
  orderDate: "تاريخ الطلب",
  orderSource: "مصدر الطلب",
  paymentStatus: "حالة الدفع",
  priority: "الأولوية",
  scheduleStatus: "حالة الجدولة",
  shipmentStatus: "حالة الشحنة",
  shipmentType: "نوع الشحنة",
  shippedFromInventory: "الشحن من المخزون",
  shippingCompany: "شركة الشحن",
  shippingFees: "سعر الشحن",
  shippingReceiveDate: "تاريخ استلام الشحنة",
  status: "حالة الطلب",
  toBeCollected: "المبلغ المطلوب تحصيله",
  totalPrice: "سعر البيع",
  userId: "المسؤول",
  vendorId: "البائع",
};

type LogMessageContext = {
  shippingCompanyNamesById?: Record<string, string>;
  userNamesById?: Record<string, string>;
  vendorNamesById?: Record<string, string>;
};

const DELIVERY_STATUS_LABELS: Record<number, string> = {
  [DELIVERY_STATUS.ON_SCHEDULE]: "بالمدة",
  [DELIVERY_STATUS.ALMOST_LAST]: "مستعجل",
  [DELIVERY_STATUS.LATE]: "متأخر",
};

const stringifyLogValue = (value: unknown): string => {
  if (typeof value === "boolean") {
    return value ? "نعم" : "لا";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
};

const getFieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;

const getMappedLogValue = (
  field: string,
  rawValue: unknown,
  context?: LogMessageContext,
): string => {
  const numericValue = toNumber(rawValue);
  const rawText = stringifyLogValue(rawValue).trim();

  if (!rawText) {
    return "";
  }

  if (field === "status") {
    return ORDER_STATUS_Arabic[numericValue as keyof typeof ORDER_STATUS_Arabic] ?? rawText;
  }

  if (field === "paymentStatus") {
    return PAYMENT_STATUS_ARABIC[numericValue as keyof typeof PAYMENT_STATUS_ARABIC] ?? rawText;
  }

  if (field === "manufactureStatus") {
    return MANUFACTURE_STATUS_ARABIC[numericValue as keyof typeof MANUFACTURE_STATUS_ARABIC] ?? rawText;
  }

  if (field === "orderSource") {
    return ORDER_SOURCE_ARABIC[numericValue as keyof typeof ORDER_SOURCE_ARABIC] ?? rawText;
  }

  if (field === "deliveryBy") {
    return DELIVERY_BY_ARABIC[numericValue as keyof typeof DELIVERY_BY_ARABIC] ?? rawText;
  }

  if (field === "deliveryStatus") {
    return DELIVERY_STATUS_LABELS[numericValue] ?? rawText;
  }

  if (field === "priority") {
    return SHIPMENT_PRIORITY_LABELS[numericValue] ?? rawText;
  }

  if (field === "shipmentStatus") {
    return SHIPMENT_STATUS_LABELS[numericValue] ?? rawText;
  }

  if (field === "scheduleStatus") {
    return SHIPMENT_SCHEDULE_STATUS_LABELS[numericValue] ?? rawText;
  }

  if (field === "shipmentType") {
    return SHIPMENT_TYPE_LABELS[rawText] ?? rawText;
  }

  if (field === "shippedFromInventory") {
    const normalized = rawText.toLowerCase();
    if (normalized === "true" || rawValue === true) {
      return "نعم";
    }
    if (normalized === "false" || rawValue === false) {
      return "لا";
    }
  }

  if (field === "vendorId") {
    return context?.vendorNamesById?.[rawText] ?? rawText;
  }

  if (field === "userId") {
    return context?.userNamesById?.[rawText] ?? rawText;
  }

  if (field === "shippingCompany") {
    return context?.shippingCompanyNamesById?.[rawText] ?? rawText;
  }

  return rawText;
};

export const buildLogMessage = (log: PlainRecord, context?: LogMessageContext): string => {
  const action = toText(log.action);
  const field = toText(log.field);

  if (action === "create" && field === "order_received") {
    return "تم استلام الطلب";
  }

  if (action === "notify" && field === "order_received_notification") {
    return "تم إرسال إشعار الطلب";
  }

  if (action === "delete") {
    return "تم حذف الطلب";
  }

  if (field === "status" && toNumber(log.to) === ORDER_STATUS.IN_PROGRESS) {
    return "بدأ التصنيع";
  }

  const fieldLabel = getFieldLabel(field);
  const nextValue = getMappedLogValue(field, log.to, context);
  if (!field) {
    return "تم تحديث الطلب";
  }

  return nextValue ? `تم تحديث ${fieldLabel} إلى ${nextValue}` : `تم تحديث ${fieldLabel}`;
};

export const getHistoryActorLabel = (userName: string): string => {
  return userName ? `بواسطة ${userName}` : "بواسطة نظام تلقائي";
};

const getLineItemsFinancials = (lineItems: unknown): { subTotalPrice: number; totalDiscounts: number } => {
  if (!Array.isArray(lineItems)) {
    return { subTotalPrice: 0, totalDiscounts: 0 };
  }

  return lineItems.reduce(
    (summary, lineValue) => {
      const line = toPlain(lineValue);
      const quantity = toNumber(line.quantity) || 0;
      const price = toNumber(line.price);
      const directDiscount = toNumber(line.discount);
      const discountAllocations = Array.isArray(line.discount_allocations)
        ? line.discount_allocations.reduce((total, allocationValue) => total + toNumber(toPlain(allocationValue).amount), 0)
        : 0;

      return {
        subTotalPrice: summary.subTotalPrice + (price * quantity),
        totalDiscounts: summary.totalDiscounts + (directDiscount || discountAllocations),
      };
    },
    { subTotalPrice: 0, totalDiscounts: 0 },
  );
};

const isPresent = (value: unknown): boolean => value !== undefined && value !== null && value !== "";

const resolveFinancialValue = (
  payload: Record<string, unknown>,
  existing: Record<string, unknown>,
  key: "downPayment" | "shippingFees" | "subTotalPrice" | "totalDiscounts" | "totalPrice",
): number => {
  if (isPresent(payload[key])) {
    return toNumber(payload[key]);
  }

  return toNumber(existing[key]);
};

export const normalizeOrderMutationPayload = (
  payloadValue: Record<string, unknown>,
  existingValue?: Record<string, unknown>,
): Record<string, unknown> => {
  const payload = { ...payloadValue };
  const existing = existingValue ?? {};
  const shipmentType = toText(payload.shipmentType, toText(existing.shipmentType)).trim();
  const nextStatus = toNumber(payload.status ?? existing.status);

  const explicitDeliveryBy = toNumber(payload.deliveryBy);
  const resolvedDeliveryBy = explicitDeliveryBy
    || (shipmentType === "warehouse" ? DELIVERY_BY.HOMIX : 0)
    || toNumber(existing.deliveryBy);

  if (resolvedDeliveryBy) {
    payload.deliveryBy = resolvedDeliveryBy;
    payload.shippedFromInventory = payload.deliveryBy === DELIVERY_BY.HOMIX;
  } else if (existingValue) {
    /* تعديل طلب قائم بلا اختيار صريح — يبقى السلوك السابق: «بائع» افتراضاً. */
    payload.deliveryBy = DELIVERY_BY.VENDOR;
    payload.shippedFromInventory = false;
  } else {
    /* إنشاء بلا اختيار صريح — تُترك للقاعدة التلقائية في saveImportedOrders
       (عدد الأصناف + المحافظة + وحدة البائع). حذفها هنا شرط لعملها. */
    Reflect.deleteProperty(payload, "deliveryBy");
    Reflect.deleteProperty(payload, "shippedFromInventory");
  }

  if (nextStatus === ORDER_STATUS.DELIVERED) {
    const currentDeliveryDate = toIsoString(payload.deliveryDate) ?? toIsoString(existing.deliveryDate);
    if (!currentDeliveryDate) {
      payload.deliveryDate = new Date().toISOString();
    }
  }

  payload.priority = resolveOrderPriority(
    payload.priority ?? existing.priority,
    payload.deliveryStatus ?? existing.deliveryStatus,
    payload.expectedDeliveryDate ?? existing.expectedDeliveryDate,
  );

  const hasLineItems = Array.isArray(payload.line_items);
  const lineItemsFinancials = getLineItemsFinancials(payload.line_items);
  /* Order creation sends a single order-level `discount`; editing sends
     `totalDiscounts`. Neither breaks the discount down per line item, so when
     one is present it must win over the (otherwise-zero) per-line sum below —
     that per-line derivation exists for Shopify imports, where each line
     carries its own discount_allocations. */
  const explicitDiscount = isPresent(payload.discount)
    ? toNumber(payload.discount)
    : isPresent(payload.totalDiscounts)
      ? toNumber(payload.totalDiscounts)
      : undefined;
  const totalDiscounts = explicitDiscount !== undefined
    ? explicitDiscount
    : hasLineItems
      ? lineItemsFinancials.totalDiscounts
      : resolveFinancialValue(payload, existing, "totalDiscounts");
  const explicitTotalPrice = resolveFinancialValue(payload, existing, "totalPrice");
  const subTotalPrice = hasLineItems
    ? lineItemsFinancials.subTotalPrice
    : (payload.subTotalPrice !== undefined && payload.subTotalPrice !== null && payload.subTotalPrice !== "")
      ? resolveFinancialValue(payload, existing, "subTotalPrice")
      : (payload.totalPrice !== undefined && payload.totalPrice !== null && payload.totalPrice !== "")
        ? explicitTotalPrice + totalDiscounts
    : resolveFinancialValue(payload, existing, "subTotalPrice");
  const shippingFees = resolveFinancialValue(payload, existing, "shippingFees");
  const downPayment = resolveFinancialValue(payload, existing, "downPayment");

  payload.subTotalPrice = subTotalPrice;
  payload.totalDiscounts = totalDiscounts;
  payload.totalPrice = subTotalPrice - totalDiscounts;
  payload.toBeCollected = subTotalPrice + shippingFees - totalDiscounts - downPayment;

  return payload;
};
