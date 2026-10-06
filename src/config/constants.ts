export const USER_TYPES = {
  ADMIN: "1",
  VENDOR: "2",
  OPERATION: "3",
  LOGISTIC: "4",
} as const;

export const ORDER_STATUS = {
  PENDING: 1,
  IN_PROGRESS: 2,
  CONFIRMED: 3,
  CANCELED: 4,
  DELIVERED: 5,
  REFUNDED: 6,
  REPLACED: 7,
  IN_INVENTORY: 8,
} as const;

export const ORDER_STATUS_ARABIC = {
  1: "معلق",
  2: "قيد التصنيع",
  3: "مؤكد",
  4: "ملغي",
  5: "تم التسليم",
  6: "مسترجع",
  7: "مستبدل",
  8: "في المخزن",
} as const;

export const DELIVERY_STATUS = {
  ON_SCHEDULE: 1,
  ALMOST_LAST: 2,
  LATE: 3,
} as const;

export const DELIVERY_BY = {
  HOMIX: 1,
  VENDOR: 2,
} as const;

export const DELIVERY_BY_ARABIC = {
  1: "هوميكس",
  2: "بائع",
} as const;

export const ORDER_LINE_ITEM_STATUS = {
  NOT_COMPLETED: 1,
  COMPLETED: 2,
  REJECTED: 3,
} as const;

export const ORDER_LINE_STATUS = {
  IN_PROGRESS: 1,
  REJECTED: 2,
  READY_FOR_DELIVERY: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
} as const;

export const PAYMENT_STATUS = {
  COD: 1,
  PAID: 2,
} as const;

export const PAYMENT_STATUS_ARABIC = {
  1: "الدفع عند الاستلام",
  2: "مدفوع",
} as const;

export const FACTORY_STATUS = {
  ONLINE: 1,
  OFFLINE: 2,
} as const;

export const SHIPMENTS_STATUS = {
  PENDING: 1,
  IN_WAREHOUSE: 2,
  READY_FOR_DELIVERY: 3,
  DELIVERED: 4,
  CANCELED: 5,
  REJECTED: 6,
  RETURNED_FROM_CUSTOMER: 7,
  RETURNED_TO_VENDOR: 8,
  REPLACED: 9,
  FAILED_DELIVERY: 10,
  SCHEDULED: 11,
  OUT_FOR_DELIVERY: 12,
} as const;

export const SHIPMENT_TYPE = {
  COLLECTED_SHIPMENT: 1,
  GOVERNORATES_SHIPMENT: 2,
} as const;

export const GOVERNORATES = {
  1: "القاهرة",
  2: "الجيزة",
  3: "الإسكندرية",
  4: "الشرقية",
  5: "الدقهلية",
  6: "البحيرة",
  7: "الغربية",
  8: "المنيا",
  9: "المنوفية",
  10: "الفيوم",
  11: "القليوبية",
  12: "بني سويف",
  13: "أسيوط",
  14: "سوهاج",
  15: "قنا",
  16: "أسوان",
  17: "الوادي الجديد",
  18: "الإسماعيلية",
  19: "بورسعيد",
  20: "السويس",
  21: "شمال سيناء",
  22: "جنوب سيناء",
  23: "مطروح",
  24: "البحر الأحمر",
  25: "الأقصر",
  26: "البحيرة",
  27: "دمياط",
} as const;

export const MANUFACTURE_STATUS = {
  ACCEPTED: 1,
  IN_PRODUCTION: 2,
  READY_FOR_DELIVERY: 3,
  DELIVERED: 4,
  FAILED_TO_DELIVER: 5,
} as const;

export const MANUFACTURE_STATUS_ARABIC = {
  1: "مقبول",
  2: "قيد التصنيع",
  3: "جاهز للشحن",
  4: "تم الشحن",
  5: "فشل في التوصيل",
  6: "تم التوصيل",
} as const;

// القيم لسه متحددتش — تتضاف هنا لاحقًا بدون أي تعديل كود تاني.
export const CONFIRMATION_STATUS = {} as const;
export const CONFIRMATION_STATUS_ARABIC: Record<number, string> = {};
