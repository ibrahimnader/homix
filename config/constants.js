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

  // HALF_COMPLETED: 3,
  // OUT_FOR_DELIVERY: 4,
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

  // HALF_COMPLETED: 3,
  // OUT_FOR_DELIVERY: 4,
};
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
};
const SHIPMENT_SCHEDULE_STATUS = {
  SCHEDULED: 1,
  NO_RESPONSE: 2,
  POSTPONED: 3,
  CANCELED_DELIVERY_DELAY: 4,
  CANCELED_CHANGED_MIND: 5,
  CANCELED_NO_RESPONSE: 6,
  CALL_LATER: 7,
};
const SHIPMENT_SCHEDULE_STATUS_ARABIC = {
  1: "مجدول",
  2: "لا يوجد رد",
  3: "مؤجل",
  4: "الغاء تأخير في التوصيل",
  5: "الغاء تغيير رأي",
  6: "الغاء لا يوجد رد",
  7: "إعادة الاتصال لاحقا",
};
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
};
const MANUFACTURE_STATUS = {
  Accepted: 1,
  IN_PRODUCTION: 2,
  READY_FOR_DELIVERY: 3,
  DELIVERED: 4,
  FAILED_TO_DELIVER: 5,
  DELIVERED_SUCCESSFULLY: 6,
};

const MANUFACTURE_STATUS_ARABIC = {
  1: "مقبول",
  2: "قيد التصنيع",
  3: "جاهز للشحن",
  4: "تم الشحن",
  5: "فشل في التوصيل",
  6: "تم التوصيل"
};
module.exports = {
  USER_TYPES,
  ORDER_STATUS,
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
  SHIPMENT_TYPE,
  GOVERNORATES,
  MANUFACTURE_STATUS,
  ORDER_SOURCE,
  ORDER_STATUS_Arabic,
  ORDER_SOURCE_ARABIC,
  PAYMENT_STATUS_ARABIC,
  MANUFACTURE_STATUS_ARABIC
};
