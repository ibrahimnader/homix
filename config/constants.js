const USER_TYPES = {
  ADMIN: "1",
  VENDOR: "2",
  OPERATION: "3",
  LOGISTIC: "4",
};
const ORDER_STATUS = {
  PENDING: 1,
  IN_PROGRESS: 2,
  CONFIRMED: 3,
  CANCELED: 4,
  DELIVERED: 5,
  REFUNDED: 6,
  REPLACED: 7,
  IN_INVENTORY: 8,
  // ids 9+ are append-only (stored as integers) — never renumber.
  CANCELED_BEFORE_MFG_CONFIRMATION: 9,
  CANCELED_AFTER_MFG_CONFIRMATION_72H: 10,
  CANCELED_AFTER_MFG_NO_RESPONSE: 11,
  CANCELED_AFTER_MFG_CHANGED_MIND: 12,
  CANCELED_AFTER_MFG_SPECIAL: 13,
  CANCELED_AFTER_MFG_DELAY: 14,
  CANCELED_AFTER_MFG_FAKE_ORDER: 15,
  REJECTED_AFTER_MFG_MISMATCH: 16,
  REJECTED_AFTER_MFG_NOT_SUITABLE: 17,
};
const ORDER_STATUS_Arabic = {
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
};
/* Cancel/reject variants added with the new design (ids 9-17). Every place that
   treats CANCELED (4) as "closed" must treat these the same — use these lists
   instead of comparing against ORDER_STATUS.CANCELED alone. */
const CLOSED_ORDER_STATUSES = [
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
const CANCELED_LIKE_ORDER_STATUSES = [ORDER_STATUS.CANCELED, ...CLOSED_ORDER_STATUSES];
const DELIVERY_STATUS = {
  ON_SCHEDULE: 1,
  ALMOST_LAST: 2,
  LATE: 3,
};
// نفس صياغة DELIVERY_STATUS في الفرونت إند (layouts/Orders/utils/constants)
const DELIVERY_STATUS_ARABIC = {
  1: "في مده التصنيع",
  2: "أوشك علي التأخير",
  3: "متأخر",
};
const DELIVERY_BY = {
  HOMIX: 1,
  VENDOR: 2,
};
const DELIVERY_BY_ARABIC = {
  1: "هوميكس",
  2: "بائع",
};
const ORDER_LINE__ITEM_STATUS = {
  NOT_COMPLETED: 1,
  COMPLETED: 2,
  REJECTED: 3,
};
const ORDER_LINE_STATUS = {
  IN_PROGRESS: 1,
  REJECTED: 2,
  READY_FOR_DELIVERY: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
};
const PAYMENT_STATUS = {
  COD: 1,
  PAID: 2,
};
const PAYMENT_STATUS_ARABIC = {
  1: "الدفع عند الاستلام",
  2: "مدفوع",
};
const ORDER_SOURCE = {
  SHOWROOM: 1,
  ONLINE: 2,
};
const ORDER_SOURCE_ARABIC = {
  1: "شو رووم",
  2: "اونلاين",
};
const FACTORY_STATUS = {
  ONLINE: 1,
  OFFLINE: 2,
};
const FACTORY_STATUS_ARABIC = {
  1: "أونلاين",
  2: "أوفلاين",
};
const FACTORY_DOCUMENT_TYPE = {
  COMMERCIAL_REGISTER: 1,
  TAX_CARD: 2,
  BANK_STATEMENT: 3,
  CONTRACT: 4,
  OTHER: 5,
};
const FACTORY_DOCUMENT_TYPE_ARABIC = {
  1: "السجل التجاري",
  2: "البطاقة الضريبية",
  3: "كشف حساب بنكي",
  4: "عقد",
  5: "أخرى",
};
const FACTORY_DOCUMENT_STATUS = {
  VERIFIED: 1,
  PENDING_REVIEW: 2,
  EXPIRED: 3,
};
const FACTORY_DOCUMENT_STATUS_ARABIC = {
  1: "موثق",
  2: "قيد المراجعة",
  3: "منتهي",
};

const SHIPMENTS_STATUS = {
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
};
/* Shipment cancel/reject variants (ids 13-21) — behave like CANCELED (5) / REJECTED (6). */
const CLOSED_SHIPMENT_STATUSES = [
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
/* الأرقام ثابتة لأن الطلبات المخزَّنة تحملها — أي إعادة ترقيم تغيّر حالة صفوف
   قائمة بالفعل. المحاولتان الثانية والثالثة أُضيفتا برقمين جديدين (8 و9)
   بدل تقسيم الرقم 2، فتبقى الصفوف القديمة على «المحاولة الأولى». */
const SHIPMENT_SCHEDULE_STATUS = {
  SCHEDULED: 1,
  NO_RESPONSE_FIRST_ATTEMPT: 2,
  POSTPONED: 3,
  CANCELED_DELIVERY_DELAY: 4,
  CANCELED_CHANGED_MIND: 5,
  CANCELED_NO_RESPONSE: 6,
  CALL_LATER: 7,
  NO_RESPONSE_SECOND_ATTEMPT: 8,
  NO_RESPONSE_THIRD_ATTEMPT: 9,
};
const SHIPMENT_SCHEDULE_STATUS_ARABIC = {
  1: "مجدول",
  2: "لا يوجد رد (محاولة أولى)",
  3: "مؤجل",
  4: "ملغي تأخير في التوصيل",
  5: "ملغي تغيير رأي",
  6: "ملغي لا يوجد رد",
  7: "إعادة الإتصال لاحقاً",
  8: "لا يوجد رد (محاولة ثانية)",
  9: "لا يوجد رد (محاولة ثالثة)",
};
/* ترتيب العرض في القوائم المنسدلة — يتبع تسلسل العمل لا ترتيب الأرقام. */
const SHIPMENT_SCHEDULE_STATUS_ORDER = [1, 3, 2, 8, 9, 6, 5, 4, 7];
const SHIPMENT_TYPE = {
  COLLECTED_SHIPMENT: 1,
  GOVERNORATES_SHIPMENT: 2,
};
const GOVERNORATES = {
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
};
const MANUFACTURE_STATUS = {
  Accepted: 1,
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
};

const MANUFACTURE_STATUS_ARABIC = {
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
};
const CONFIRMATION_STATUS = {
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
};

const CONFIRMATION_STATUS_ARABIC = {
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
module.exports = {
  USER_TYPES,
  ORDER_STATUS,
  CLOSED_ORDER_STATUSES,
  CANCELED_LIKE_ORDER_STATUSES,
  CLOSED_SHIPMENT_STATUSES,
  PAYMENT_STATUS,
  FACTORY_STATUS,
  FACTORY_STATUS_ARABIC,
  FACTORY_DOCUMENT_TYPE,
  FACTORY_DOCUMENT_TYPE_ARABIC,
  FACTORY_DOCUMENT_STATUS,
  FACTORY_DOCUMENT_STATUS_ARABIC,
  ORDER_LINE_STATUS,
  ORDER_LINE__ITEM_STATUS,
  DELIVERY_STATUS,
  DELIVERY_STATUS_ARABIC,
  DELIVERY_BY,
  DELIVERY_BY_ARABIC,
  SHIPMENTS_STATUS,
  SHIPMENT_SCHEDULE_STATUS,
  SHIPMENT_SCHEDULE_STATUS_ARABIC,
  SHIPMENT_SCHEDULE_STATUS_ORDER,
  SHIPMENT_TYPE,
  GOVERNORATES,
  MANUFACTURE_STATUS,
  ORDER_SOURCE,
  ORDER_STATUS_Arabic,
  ORDER_SOURCE_ARABIC,
  PAYMENT_STATUS_ARABIC,
  MANUFACTURE_STATUS_ARABIC,
  CONFIRMATION_STATUS,
  CONFIRMATION_STATUS_ARABIC
};
