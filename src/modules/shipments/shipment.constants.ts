import {
  CLOSED_SHIPMENT_STATUSES,
  DELIVERY_BY_ARABIC,
  GOVERNORATES,
  PAYMENT_STATUS_ARABIC,
  SHIPMENT_SCHEDULE_STATUS as SHIPMENT_SCHEDULE_STATUS_KEYS,
  SHIPMENT_SCHEDULE_STATUS_ARABIC,
  SHIPMENT_SCHEDULE_STATUS_ORDER,
} from "../../../config/constants";

export const DEFAULT_PAGE_NUMBER = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const SHIPMENT_PRIORITY = {
  ON_SCHEDULE: 1,
  ALMOST_DUE: 2,
  URGENT: 3,
} as const;

export const SHIPMENT_PRIORITY_KEYS = [
  SHIPMENT_PRIORITY.ON_SCHEDULE,
  SHIPMENT_PRIORITY.ALMOST_DUE,
  SHIPMENT_PRIORITY.URGENT,
] as const;

export const SHIPMENT_PRIORITY_LABELS: Record<number, string> = {
  [SHIPMENT_PRIORITY.ON_SCHEDULE]: "بالمدة",
  [SHIPMENT_PRIORITY.ALMOST_DUE]: "مستعجل",
  [SHIPMENT_PRIORITY.URGENT]: "مستعجل جدا",
};

export const SHIPMENT_STATUS = {
  PENDING: 1,
  IN_WAREHOUSE: 2,
  READY_FOR_SHIPPING: 3,
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

export const SHIPMENT_STATUS_LABELS: Record<number, string> = {
  [SHIPMENT_STATUS.PENDING]: "معلقة",
  [SHIPMENT_STATUS.IN_WAREHOUSE]: "في المخزن",
  [SHIPMENT_STATUS.READY_FOR_SHIPPING]: "جاهزة للشحن",
  [SHIPMENT_STATUS.DELIVERED]: "تم التسليم",
  [SHIPMENT_STATUS.CANCELED]: "ملغية",
  [SHIPMENT_STATUS.REJECTED]: "مرفوضة",
  [SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER]: "مسترجع من العميل",
  [SHIPMENT_STATUS.RETURNED_TO_VENDOR]: "مرتجع للمورد",
  [SHIPMENT_STATUS.REPLACED]: "مستبدل",
  [SHIPMENT_STATUS.FAILED_DELIVERY]: "فشل في التوصيل",
  [SHIPMENT_STATUS.SCHEDULED]: "شحنة مجدولة",
  [SHIPMENT_STATUS.OUT_FOR_DELIVERY]: "خرجت للتوصيل",
  [SHIPMENT_STATUS.CANCELED_BEFORE_MFG_CONFIRMATION]: "ملغي قبل التأكيد للتصنيع",
  [SHIPMENT_STATUS.CANCELED_AFTER_MFG_CONFIRMATION_72H]: "ملغي بعد التأكيد للتصنيع (خلال أول 72 ساعة)",
  [SHIPMENT_STATUS.CANCELED_AFTER_MFG_NO_RESPONSE]: "ملغي بعد التصنيع (لا يوجد رد من العميل)",
  [SHIPMENT_STATUS.CANCELED_AFTER_MFG_CHANGED_MIND]: "ملغي بعد التصنيع (تغيير رأي)",
  [SHIPMENT_STATUS.CANCELED_AFTER_MFG_SPECIAL]: "ملغي بعد التصنيع (ظروف خاصة)",
  [SHIPMENT_STATUS.CANCELED_AFTER_MFG_DELAY]: "ملغي بعد التصنيع (بسبب التأخير)",
  [SHIPMENT_STATUS.CANCELED_AFTER_MFG_FAKE_ORDER]: "ملغي بعد التصنيع (طلب وهمي)",
  [SHIPMENT_STATUS.REJECTED_AFTER_MFG_MISMATCH]: "مرفوض بعد التصنيع (المنتج غير مطابق)",
  [SHIPMENT_STATUS.REJECTED_AFTER_MFG_NOT_SUITABLE]: "مرفوض بعد التصنيع (غير مناسب للعميل)",
};

/* مصدر الحقيقة الوحيد لحالات الجدولة هو `config/constants` — تُقرأ من هناك حتى
   لا تنحرف قائمة الواجهة عن القائمة التي تُكتب بها الصفوف. */
export const SHIPMENT_SCHEDULE_STATUS = SHIPMENT_SCHEDULE_STATUS_KEYS as {
  CALL_LATER: number;
  CANCELED_CHANGED_MIND: number;
  CANCELED_DELIVERY_DELAY: number;
  CANCELED_NO_RESPONSE: number;
  NO_RESPONSE_FIRST_ATTEMPT: number;
  NO_RESPONSE_SECOND_ATTEMPT: number;
  NO_RESPONSE_THIRD_ATTEMPT: number;
  POSTPONED: number;
  SCHEDULED: number;
};

export const SHIPMENT_SCHEDULE_STATUS_LABELS = SHIPMENT_SCHEDULE_STATUS_ARABIC as Record<number, string>;

/** ترتيب العرض في القوائم المنسدلة — يتبع تسلسل العمل لا ترتيب الأرقام. */
export const SHIPMENT_SCHEDULE_STATUS_OPTIONS: Array<{ id: number; label: string }> =
  SHIPMENT_SCHEDULE_STATUS_ORDER
    .filter((id) => SHIPMENT_SCHEDULE_STATUS_LABELS[id] !== undefined)
    .map((id) => ({ id, label: SHIPMENT_SCHEDULE_STATUS_LABELS[id] as string }));

export const SHIPMENT_TYPE_LABELS: Record<string, string> = {
  collected: "شحن مجمع",
  grouped: "شحن مجمع",
  separate: "شحن منفصل",
  single: "شحن منفصل",
  warehouse: "شحن مجمع",
};

export const SHIPMENT_RETURN_TYPE = {
  TO_VENDOR: 1,
  FROM_CUSTOMER: 2,
} as const;

export const SHIPMENT_RETURN_TYPE_LABELS: Record<number, string> = {
  [SHIPMENT_RETURN_TYPE.TO_VENDOR]: "مرتجعات إلى المورد",
  [SHIPMENT_RETURN_TYPE.FROM_CUSTOMER]: "مسحوبات من العميل",
};

export const RETURN_TO_VENDOR_STATUS = {
  PENDING: 1,
  VENDOR_NOTIFIED: 2,
  DELIVERED_TO_VENDOR: 3,
  FORFEIT: 4,
} as const;

export const RETURN_TO_VENDOR_STATUS_LABELS: Record<number, string> = {
  [RETURN_TO_VENDOR_STATUS.PENDING]: "معلق",
  [RETURN_TO_VENDOR_STATUS.VENDOR_NOTIFIED]: "تم إبلاغ المورد",
  [RETURN_TO_VENDOR_STATUS.DELIVERED_TO_VENDOR]: "تم التسليم للمورد",
  [RETURN_TO_VENDOR_STATUS.FORFEIT]: "فورفيت",
};

export const RETURN_TO_VENDOR_FINAL_STATUSES = [
  RETURN_TO_VENDOR_STATUS.DELIVERED_TO_VENDOR,
  RETURN_TO_VENDOR_STATUS.FORFEIT,
];

export const CUSTOMER_RETURN_STATUS = {
  PENDING: 1,
  PICKED_UP: 2,
  IN_WAREHOUSE: 3,
  CANCELED: 4,
  REDELIVERED: 5,
  FORFEIT: 6,
} as const;

export const CUSTOMER_RETURN_STATUS_LABELS: Record<number, string> = {
  [CUSTOMER_RETURN_STATUS.PENDING]: "معلق",
  [CUSTOMER_RETURN_STATUS.PICKED_UP]: "تم السحب",
  [CUSTOMER_RETURN_STATUS.IN_WAREHOUSE]: "في المخزن",
  [CUSTOMER_RETURN_STATUS.CANCELED]: "ملغي",
  [CUSTOMER_RETURN_STATUS.REDELIVERED]: "تم التوصيل للعميل",
  [CUSTOMER_RETURN_STATUS.FORFEIT]: "فورفيت",
};

export const CUSTOMER_RETURN_FINAL_STATUSES = [
  CUSTOMER_RETURN_STATUS.CANCELED,
  CUSTOMER_RETURN_STATUS.REDELIVERED,
  CUSTOMER_RETURN_STATUS.FORFEIT,
];

export const ACCOUNTING_STATUS = {
  PENDING: 1,
  SETTLED: 2,
} as const;

export const EXPENSE_STATUS_LABELS: Record<number, string> = {
  [ACCOUNTING_STATUS.PENDING]: "معلق",
  [ACCOUNTING_STATUS.SETTLED]: "تم التصفية",
};

export const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  [ACCOUNTING_STATUS.PENDING]: "معلق",
  [ACCOUNTING_STATUS.SETTLED]: "تم التصفية",
};

export const INVENTORY_STATUS = {
  IN_STOCK: 1,
  OUT_OF_STOCK: 2,
} as const;

export const INVENTORY_STATUS_LABELS: Record<number, string> = {
  [INVENTORY_STATUS.IN_STOCK]: "متوفر بالمخزون",
  [INVENTORY_STATUS.OUT_OF_STOCK]: "نفذ بالمخزون",
};

export const EXPENSE_TYPE = {
  SHIPPING: 1,
  PACKAGING: 2,
  MAINTENANCE: 3,
  WAREHOUSE_RENT: 4,
  SALARIES: 5,
  OTHER: 6,
} as const;

export const EXPENSE_TYPE_LABELS: Record<number, string> = {
  [EXPENSE_TYPE.SHIPPING]: "شحن",
  [EXPENSE_TYPE.PACKAGING]: "تغليف",
  [EXPENSE_TYPE.MAINTENANCE]: "صيانة",
  [EXPENSE_TYPE.WAREHOUSE_RENT]: "إيجار مخزن",
  [EXPENSE_TYPE.SALARIES]: "رواتب",
  [EXPENSE_TYPE.OTHER]: "أخرى",
};

export const PAYMENT_STATUS_LABELS = PAYMENT_STATUS_ARABIC as Record<number, string>;
export const DELIVERY_BY_LABELS = DELIVERY_BY_ARABIC as Record<number, string>;
export const GOVERNORATE_LABELS = GOVERNORATES as Record<number, string>;

export const SHIPMENT_FINAL_STATUSES = [
  SHIPMENT_STATUS.DELIVERED,
  SHIPMENT_STATUS.CANCELED,
  SHIPMENT_STATUS.REJECTED,
  SHIPMENT_STATUS.RETURNED_TO_VENDOR,
  ...CLOSED_SHIPMENT_STATUSES,
];

export const PERFORMANCE_PERIODS = ["daily", "weekly", "monthly", "custom"] as const;
