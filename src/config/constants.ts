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
  CANCELED_BEFORE_MFG_CONFIRMATION: 9,
  CANCELED_AFTER_MFG_CONFIRMATION_72H: 10,
  CANCELED_AFTER_MFG_NO_RESPONSE: 11,
  CANCELED_AFTER_MFG_CHANGED_MIND: 12,
  CANCELED_AFTER_MFG_SPECIAL: 13,
  CANCELED_AFTER_MFG_DELAY: 14,
  CANCELED_AFTER_MFG_FAKE_ORDER: 15,
  REJECTED_AFTER_MFG_MISMATCH: 16,
  REJECTED_AFTER_MFG_NOT_SUITABLE: 17,
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
  9: "ملغي قبل التأكيد للتصنيع",
  10: "ملغي بعد التأكيد للتصنيع (خلال أول 72 ساعة)",
  11: "ملغي بعد التصنيع (لا يوجد رد من العميل)",
  12: "ملغي بعد التصنيع (تغيير رأي)",
  13: "ملغي بعد التصنيع (ظروف خاصة)",
  14: "ملغي بعد التصنيع (بسبب التأخير)",
  15: "ملغي بعد التصنيع (طلب وهمي)",
  16: "مرفوض بعد التصنيع (المنتج غير مطابق)",
  17: "مرفوض بعد التصنيع (غير مناسب للعميل)",
} as const;

/** Cancel/reject variants (ids 9-17): treat like CANCELED everywhere. Mirror of config/constants.js. */
export const CLOSED_ORDER_STATUSES: readonly number[] = [
  ORDER_STATUS.CANCELED_BEFORE_MFG_CONFIRMATION,
  ORDER_STATUS.CANCELED_AFTER_MFG_CONFIRMATION_72H,
  ORDER_STATUS.CANCELED_AFTER_MFG_NO_RESPONSE,
  ORDER_STATUS.CANCELED_AFTER_MFG_CHANGED_MIND,
  ORDER_STATUS.CANCELED_AFTER_MFG_SPECIAL,
  ORDER_STATUS.CANCELED_AFTER_MFG_DELAY,
  ORDER_STATUS.CANCELED_AFTER_MFG_FAKE_ORDER,
  ORDER_STATUS.REJECTED_AFTER_MFG_MISMATCH,
  ORDER_STATUS.REJECTED_AFTER_MFG_NOT_SUITABLE,
];
export const CANCELED_LIKE_ORDER_STATUSES: readonly number[] = [ORDER_STATUS.CANCELED, ...CLOSED_ORDER_STATUSES];

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
  CANCELED_BEFORE_MFG_CONFIRMATION: 13,
  CANCELED_AFTER_MFG_CONFIRMATION_72H: 14,
  CANCELED_AFTER_MFG_NO_RESPONSE: 15,
  CANCELED_AFTER_MFG_CHANGED_MIND: 16,
  CANCELED_AFTER_MFG_SPECIAL: 17,
  CANCELED_AFTER_MFG_DELAY: 18,
  CANCELED_AFTER_MFG_FAKE_ORDER: 19,
  REJECTED_AFTER_MFG_MISMATCH: 20,
  REJECTED_AFTER_MFG_NOT_SUITABLE: 21,
} as const;

/** Shipment cancel/reject variants (ids 13-21): treat like CANCELED/REJECTED. */
export const CLOSED_SHIPMENT_STATUSES: readonly number[] = [
  SHIPMENTS_STATUS.CANCELED_BEFORE_MFG_CONFIRMATION,
  SHIPMENTS_STATUS.CANCELED_AFTER_MFG_CONFIRMATION_72H,
  SHIPMENTS_STATUS.CANCELED_AFTER_MFG_NO_RESPONSE,
  SHIPMENTS_STATUS.CANCELED_AFTER_MFG_CHANGED_MIND,
  SHIPMENTS_STATUS.CANCELED_AFTER_MFG_SPECIAL,
  SHIPMENTS_STATUS.CANCELED_AFTER_MFG_DELAY,
  SHIPMENTS_STATUS.CANCELED_AFTER_MFG_FAKE_ORDER,
  SHIPMENTS_STATUS.REJECTED_AFTER_MFG_MISMATCH,
  SHIPMENTS_STATUS.REJECTED_AFTER_MFG_NOT_SUITABLE,
];

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
  28: "الساحل الشمالي",
  29: "العين السخنة",
  30: "المنصورة",
  31: "كفر الشيخ",
} as const;

export const MANUFACTURE_STATUS = {
  ACCEPTED: 1,
  IN_PRODUCTION: 2,
  READY_FOR_DELIVERY: 3,
  DELIVERED: 4,
  FAILED_TO_DELIVER: 5,
  DELIVERED_SUCCESSFULLY: 6,
  IN_WAREHOUSE: 7,
  CANCELED_BEFORE_MFG_CONFIRMATION: 8,
  CANCELED_AFTER_MFG_CONFIRMATION_72H: 9,
  CANCELED_NO_RESPONSE: 10,
  CANCELED_CHANGED_MIND: 11,
  CANCELED_SPECIAL: 12,
  CANCELED_DELAY: 13,
  CANCELED_FAKE_ORDER: 14,
  REJECTED_MISMATCH: 15,
  REJECTED_NOT_SUITABLE: 16,
  RETURNED: 17,
  EXCHANGED: 18,
} as const;

export const MANUFACTURE_STATUS_ARABIC = {
  1: "مقبول",
  2: "قيد التصنيع",
  3: "جاهز للشحن",
  4: "تم الشحن",
  5: "فشل في التوصيل",
  6: "تم التوصيل",
  7: "في المخزن",
  8: "ملغي قبل تأكيد التصنيع",
  9: "ملغي بعد تأكيد التصنيع (خلال أول 72 ساعة)",
  10: "ملغي (لا يوجد رد من العميل)",
  11: "ملغي (تغيير رأي)",
  12: "ملغي (ظروف خاصة)",
  13: "ملغي (بسبب التأخير)",
  14: "ملغي (طلب وهمي)",
  15: "مرفوض (المنتج غير مطابق)",
  16: "مرفوض (غير مناسب للعميل)",
  17: "مسترجع",
  18: "مستبدل",
} as const;

export const CONFIRMATION_STATUS = {
  PENDING: 1,
  CONFIRMED: 2,
  NO_ANSWER_FIRST_ATTEMPT: 3,
  NO_ANSWER_SECOND_ATTEMPT: 4,
  NO_ANSWER_THIRD_ATTEMPT: 5,
  CALL_BACK_LATER: 6,
  CANCELED_NO_CUSTOMER_RESPONSE: 7,
  CANCELED_FAKE_ORDER: 8,
  CANCELED_DUPLICATE_ORDER: 9,
  CANCELED_SPECIAL_CIRCUMSTANCES: 10,
  CANCELED_CHANGED_MIND: 11,
} as const;

export const CONFIRMATION_STATUS_ARABIC: Record<number, string> = {
  1: "معلق",
  2: "مؤكد",
  3: "لا يوجد رد (محاولة الأولى)",
  4: "لا يوجد رد (محاولة الثانية)",
  5: "لا يوجد رد (محاولة الثالثة)",
  6: "إعادة الاتصال لاحقًا",
  7: "ملغي (لا يوجد رد من العميل)",
  8: "ملغي (طلب وهمي)",
  9: "ملغي (تكرار الطلب)",
  10: "ملغي (ظروف خاصة)",
  11: "ملغي (تغيير رأي)",
};
