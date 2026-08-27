import { USER_TYPES } from "../../../config/constants";

export const USER_ACCOUNT_STATUSES = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
} as const;

export const USER_ROLE_LABELS = {
  [USER_TYPES.ADMIN]: "مدير",
  [USER_TYPES.LOGISTIC]: "لوجستي",
  [USER_TYPES.OPERATION]: "عمليات",
  [USER_TYPES.VENDOR]: "بائع",
} as const;

export const USER_PERMISSION_GROUPS = [
  {
    key: "dashboard",
    label: "لوحة التحكم",
    permissions: [
      { key: "dashboard_view", label: "عرض لوحة التحكم" },
    ],
  },
  {
    key: "orders",
    label: "الطلبات",
    permissions: [
      { key: "orders_view", label: "عرض الطلبات" },
      { key: "orders_edit", label: "تعديل الطلبات" },
      { key: "orders_create", label: "إنشاء طلب" },
      { key: "orders_delete", label: "حذف الطلبات" },
    ],
  },
  {
    key: "factory",
    label: "الصُنّاع",
    permissions: [
      { key: "factory_view", label: "عرض الصُنّاع" },
      { key: "factory_edit", label: "تعديل بيانات المصنع" },
      { key: "factory_delete", label: "حذف مصنع" },
    ],
  },
  {
    key: "products",
    label: "المنتجات",
    permissions: [
      { key: "products_view", label: "عرض المنتجات" },
      { key: "products_edit", label: "إضافة وتعديل المنتجات" },
      { key: "products_import", label: "استيراد المنتجات" },
    ],
  },
  {
    key: "vendors",
    label: "البائعين",
    permissions: [
      { key: "vendors_view", label: "عرض البائعين" },
      { key: "vendors_create", label: "إنشاء بائع" },
      { key: "vendors_edit", label: "تعديل البائعين" },
      { key: "vendors_delete", label: "حذف البائعين" },
    ],
  },
  {
    key: "employees",
    label: "الموظفين",
    permissions: [
      { key: "employees_view", label: "عرض الموظفين" },
      { key: "employees_create", label: "إنشاء موظف" },
      { key: "employees_edit", label: "تعديل الموظفين" },
      { key: "employees_delete", label: "حذف الموظفين" },
    ],
  },
  {
    key: "customers",
    label: "العملاء",
    permissions: [
      { key: "customers_view", label: "عرض العملاء" },
      { key: "customers_edit", label: "تعديل العملاء" },
    ],
  },
  {
    key: "ship",
    label: "الشحن والتوصيل",
    permissions: [
      { key: "ship_view", label: "عرض الشحنات" },
      { key: "ship_edit", label: "تعديل الشحنات" },
      { key: "ship_inventory_view", label: "عرض المخزون" },
      { key: "ship_returns_view", label: "عرض المرتجعات" },
      { key: "ship_accounts_view", label: "عرض الحسابات" },
      { key: "ship_delivery_accounts_view", label: "عرض حسابات التسليم" },
      { key: "ship_expenses_view", label: "عرض المصروفات" },
      { key: "ship_performance_view", label: "عرض تقارير الأداء" },
    ],
  },
  {
    key: "finance",
    label: "المالية",
    permissions: [
      { key: "finance_view", label: "عرض التقارير" },
      { key: "finance_export", label: "تصدير التقارير" },
      { key: "finance_settle", label: "تسوية مالية" },
    ],
  },
  {
    key: "tickets",
    label: "التذاكر",
    permissions: [
      { key: "tickets_view", label: "عرض التذاكر" },
      { key: "tickets_reply", label: "الرد على التذاكر" },
      { key: "tickets_close", label: "إغلاق التذاكر" },
    ],
  },
  {
    key: "notifications",
    label: "الإشعارات",
    permissions: [
      { key: "notifications_view", label: "عرض الإشعارات" },
      { key: "notifications_manage", label: "إدارة الإشعارات" },
    ],
  },
  {
    key: "users",
    label: "المستخدمون والإعدادات",
    permissions: [
      { key: "users_view", label: "عرض المستخدمين" },
      { key: "users_manage", label: "إدارة الصلاحيات" },
      { key: "settings_view", label: "عرض الإعدادات" },
      { key: "settings_edit", label: "تعديل الإعدادات" },
    ],
  },
] as const;

export const USER_PERMISSION_TEMPLATES = {
  admin: {
    dashboard_view: true,
    orders_view: true,
    orders_edit: true,
    orders_delete: true,
    orders_create: true,
    factory_view: true,
    factory_edit: true,
    factory_delete: true,
    products_view: true,
    products_edit: true,
    products_import: true,
    vendors_view: true,
    vendors_create: true,
    vendors_edit: true,
    vendors_delete: true,
    employees_view: true,
    employees_create: true,
    employees_edit: true,
    employees_delete: true,
    customers_view: true,
    customers_edit: true,
    ship_view: true,
    ship_edit: true,
    ship_inventory_view: true,
    ship_returns_view: true,
    ship_accounts_view: true,
    ship_delivery_accounts_view: true,
    ship_expenses_view: true,
    ship_performance_view: true,
    finance_view: true,
    finance_export: true,
    finance_settle: true,
    tickets_view: true,
    tickets_reply: true,
    tickets_close: true,
    notifications_view: true,
    notifications_manage: true,
    users_view: true,
    users_manage: true,
    settings_view: true,
    settings_edit: true,
  },
  logistics: {
    dashboard_view: true,
    ship_view: true,
    ship_edit: true,
    /* تبويبات قسم الشحنات كلها متاحة لأي مستخدم غير بائع، وليست حكراً على المالية. */
    ship_inventory_view: true,
    ship_returns_view: true,
    ship_accounts_view: true,
    ship_delivery_accounts_view: true,
    ship_expenses_view: true,
    ship_performance_view: true,
    /* بدونها كانت تظهر تسليمات الحسابات لكن كل حفظ (تعديل الحالة/التاريخ/المرجع،
       bulk edit، الإخفاء) يرجع 403 — اللوجيستي هو مين بيمسك التسويات يوميًا. */
    finance_settle: true,
    orders_view: true,
    /* logisticsRoutes على main كانت تشمل /products */
    products_view: true,
    factory_view: true,
    notifications_view: true,
    notifications_manage: true,
  },
  ops: {
    dashboard_view: true,
    orders_view: true,
    orders_edit: true,
    orders_create: true,
    factory_view: true,
    products_view: true,
    vendors_view: true,
    customers_view: true,
    customers_edit: true,
    ship_view: true,
    ship_inventory_view: true,
    ship_returns_view: true,
    ship_accounts_view: true,
    ship_delivery_accounts_view: true,
    ship_expenses_view: true,
    ship_performance_view: true,
    tickets_view: true,
    tickets_reply: true,
    notifications_view: true,
    notifications_manage: true,
  },
  vendor: {
    /* البائع يرى: الرئيسية · المنتجات · الطلبات فقط.
       التقارير المالية والتذاكر مُقفلة عليه بقرار العمل (كانت متاحة على main). */
    dashboard_view: true,
    products_view: true,
    orders_view: true,
    /* لازمة لتحديث «حالة التصنيع» فقط — الباك إند يحصر ما يقبله من البائع
       في restrictVendorOrderPayload، فلا يستطيع تعديل الحالة أو الأولوية أو
       المسؤول أو التوصيل بواسطة أو أي حقل مالي. */
    orders_edit: true,
    notifications_view: true,
    notifications_manage: true,
  },
  finance: {
    dashboard_view: true,
    finance_view: true,
    finance_export: true,
    finance_settle: true,
    ship_view: true,
    ship_inventory_view: true,
    ship_returns_view: true,
    ship_accounts_view: true,
    ship_delivery_accounts_view: true,
    ship_expenses_view: true,
    ship_performance_view: true,
    orders_view: true,
    notifications_view: true,
    notifications_manage: true,
  },
  none: {},
} as const;

export const ALL_USER_PERMISSION_KEYS = USER_PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key));

export const getPermissionTemplateForUserType = (userType?: string, roleName?: string): Record<string, boolean> => {
  if (roleName?.includes("مالية")) {
    return { ...USER_PERMISSION_TEMPLATES.finance };
  }

  if (userType === USER_TYPES.ADMIN) {
    return { ...USER_PERMISSION_TEMPLATES.admin };
  }

  if (userType === USER_TYPES.LOGISTIC) {
    return { ...USER_PERMISSION_TEMPLATES.logistics };
  }

  if (userType === USER_TYPES.OPERATION) {
    return { ...USER_PERMISSION_TEMPLATES.ops };
  }

  if (userType === USER_TYPES.VENDOR) {
    return { ...USER_PERMISSION_TEMPLATES.vendor };
  }

  return { ...USER_PERMISSION_TEMPLATES.none };
};
