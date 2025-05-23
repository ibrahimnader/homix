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

  // HALF_COMPLETED: 3,
  // OUT_FOR_DELIVERY: 4,
};
const ORDER_STATUS_Arabic = {
  1: "معلق",
  2: "قيد التنفيذ",
  3: "مؤكد",
  4: "ملغي",
  5: "تم التسليم",
  6: "مسترد",
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
const FACTORY_STATUS = {
  ONLINE: 1,
  OFFLINE: 2,
};

const SHIPMENTS_STATUS = {
  PENDING: 1,
  IN_WAREHOUSE: 2,
  READY_FOR_DELIVERY: 3,
  DELIVERED: 4,
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
};
const MANUFACTURE_STATUS = {
  Accepted: 1,
  IN_PRODUCTION: 2,
  READY_FOR_DELIVERY: 3,
  DELIVERED: 4,
  FAILED_TO_DELIVER: 5,
};

const MANUFACTURE_STATUS_ARABIC = {
  1: "مقبول",
  2: "قيد الإنتاج",
  3: "جاهز للتسليم",
  4: "تم التسليم",
  5: "فشل في التسليم",
};
module.exports = {
  USER_TYPES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  FACTORY_STATUS,
  ORDER_LINE_STATUS,
  ORDER_LINE__ITEM_STATUS,
  DELIVERY_STATUS,
  SHIPMENTS_STATUS,
  SHIPMENT_TYPE,
  GOVERNORATES,
  MANUFACTURE_STATUS,
  ORDER_STATUS_Arabic,
  PAYMENT_STATUS_ARABIC,
  MANUFACTURE_STATUS_ARABIC
};
