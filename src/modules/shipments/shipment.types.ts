import type { Request } from "express";

import type { PERFORMANCE_PERIODS } from "./shipment.constants";

export type ShipmentRequestUser = NonNullable<Request["user"]>;

export type ShipmentListQuery = {
  customerName?: string;
  customerPhone?: string;
  deliveryBy?: string;
  deliveryStatus?: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  endDate?: string;
  governorate?: string;
  operationCode?: string;
  orderSource?: string;
  orderNumber?: string;
  page: number;
  paymentStatus?: string;
  priority?: string;
  scheduleStatus?: string;
  scheduledDateFrom?: string;
  scheduledDateTo?: string;
  shippingCompany?: string;
  shipmentNumber?: string;
  shipmentStatus?: string;
  shipmentType?: string;
  sort?: Partial<Record<"orderDate" | "priority" | "subTotalPrice" | "totalPrice", 1 | -1>>;
  size: number;
  startDate?: string;
  vendorName?: string;
};

export type ReturnListQuery = {
  operationCode?: string;
  orderNumber?: string;
  page: number;
  sellerName?: string;
  size: number;
  status?: number;
};

export type ReturnMutationInput = {
  orderId: number;
  reason: string;
  returnDate?: string | null;
  status?: number;
};

export type InventoryListQuery = {
  page: number;
  productCode?: string;
  size: number;
  status?: number;
  vendorName?: string;
};

export type InventoryMutationInput = {
  color?: string;
  costPrice: number;
  productId: number;
  productCode: string;
  quantity: number;
  size?: string;
  status?: number;
};

export type DeliveryAccountsListQuery = {
  accountingStatus?: number;
  orderNumber?: string;
  page: number;
  paymentMethod?: string;
  settledDate?: string;
  size: number;
};

export type ExpenseAccountsListQuery = {
  accountingStatus?: number;
  page: number;
  size: number;
  type?: number;
};

export type ExpenseMutationInput = {
  accountingDate?: string | null;
  accountingStatus?: number;
  amount: number;
  reason: string;
  type: number;
};

export type PerformanceQuery = {
  endDate?: string;
  period: (typeof PERFORMANCE_PERIODS)[number];
  startDate?: string;
};

export type ShipmentMetaOption = {
  id: number | string;
  label: string;
};

export type ShipmentMetaResponse = {
  accountingStatuses: ShipmentMetaOption[];
  assignees: ShipmentMetaOption[];
  customerReturnStatuses: ShipmentMetaOption[];
  deliveryByOptions: ShipmentMetaOption[];
  expenseTypes: ShipmentMetaOption[];
  governorates: ShipmentMetaOption[];
  inventoryStatuses: ShipmentMetaOption[];
  orderSources: ShipmentMetaOption[];
  paymentStatuses: ShipmentMetaOption[];
  priorities: ShipmentMetaOption[];
  scheduleStatuses: ShipmentMetaOption[];
  shippingCompanies: ShipmentMetaOption[];
  shipmentStatuses: ShipmentMetaOption[];
  shipmentTypes: ShipmentMetaOption[];
  subTabCounts: {
    accountDeliveries: number;
    accountExpenses: number;
    customerReturns: number;
    vendorReturns: number;
  };
  tabs: Array<{ count?: number; id: string; label: string }>;
  vendorReturnStatuses: ShipmentMetaOption[];
};

export type ShipmentSummaryCard = {
  description: string;
  key: string;
  label: string;
  value: number;
};

export type ShipmentSummaryResponse = {
  cards: ShipmentSummaryCard[];
};

export type ShipmentListItem = {
  assigneeId: number | null;
  amountToCollect: number;
  customerName: string;
  customerPhone: string;
  daysCounter: number | null;
  deliveryBy: number | null;
  deliveryByLabel: string;
  deliveryPriority: number | null;
  deliveryPriorityLabel: string;
  deliveryStatus: number | null;
  priority: number | null;
  priorityLabel: string;
  deliveryDate: string | null;
  orderSource: number | null;
  orderSourceLabel: string;
  operationNumber: string;
  orderNumber: string;
  paymentStatus: number | null;
  paymentStatusLabel: string;
  receivedInWarehouseDate: string | null;
  scheduledDeliveryDate: string | null;
  scheduleStatus: number | null;
  scheduleStatusLabel: string;
  sellerName: string;
  shippingCompany: number | null;
  shippingCompanyName: string;
  shipmentNumber: string;
  shipmentStatus: number | null;
  shipmentStatusLabel: string;
  shipmentType: string;
  shipmentTypeLabel: string;
  shippingCost: number;
  id: number;
  governorate: string;
};

export type ShipmentListResponse = {
  items: ShipmentListItem[];
  page: number;
  size: number;
  totalCount: number;
};

export type ShipmentNote = {
  createdAt: string;
  id: number;
  text: string;
  userName: string;
};

export type ShipmentTimelineItem = {
  changedAt: string;
  id: number;
  message: string;
  userName: string;
};

export type ShipmentDetailsResponse = {
  customer: {
    address: string;
    name: string;
    phoneNumber: string;
  };
  financial: {
    amountToCollect: number;
    discount: number;
    downPayment: number;
    receivedAmount: number;
    shippingCost: number;
    totalPrice: number;
  };
  notes: ShipmentNote[];
  products: Array<{
    color: string;
    image: string;
    price: number;
    productCode: string;
    productName: string;
    quantity: number;
    size: string;
    variant: {
      color: string;
      id: string;
      inventoryQuantity: number | null;
      material: string;
      price: number;
      size: string;
      sku: string;
      title: string;
    };
    vendorName: string;
  }>;
  shipment: ShipmentListItem & {
    deliveryStatus: number | null;
    shippedFromInventory: boolean;
    shippingCompanyName: string;
  };
  timeline: ShipmentTimelineItem[];
  vendor: {
    name: string;
  };
};

export type ReturnItem = {
  daysCounter: number | null;
  id: number;
  /** Real order id. The row is an order; `id` may be the return row's id. */
  orderId: number;
  operationNumber: string;
  orderNumber: string;
  reason: string;
  returnDate: string | null;
  sellerName: string;
  status: number;
  statusLabel: string;
  returnType: number;
  returnTypeLabel: string;
};

export type ReturnListResponse = {
  items: ReturnItem[];
  page: number;
  size: number;
  totalCount: number;
};

export type InventoryItem = {
  color: string;
  costPrice: number;
  id: number;
  image: string;
  productId: number | null;
  productCode: string;
  productName: string;
  quantity: number;
  size: string;
  status: number;
  statusLabel: string;
  vendorId: number | null;
  vendorName: string;
};

export type InventoryListResponse = {
  items: InventoryItem[];
  page: number;
  size: number;
  totalCount: number;
};

export type DeliveryAccountItem = {
  accountingDate: string | null;
  /** Order id — the ledger row is the delivered order itself. */
  id: number;
  accountingStatus: number;
  accountingStatusLabel: string;
  amountToCollect: number;
  deliveryDate: string | null;
  operationNumber: string;
  orderNumber: string;
  paymentMethod: string;
  paymentMethodLabel: string;
  productCode: string;
  /** ما استُلم فعليًا — يُفترض مساويًا للمبلغ المطلوب تحصيله ما لم يُعدَّل صراحةً. */
  receivedAmount: number;
  reference: string;
  sellerName: string;
  sellingPrice: number;
  shippingCompanyName: string;
};

export type DeliveryAccountsListResponse = {
  items: DeliveryAccountItem[];
  page: number;
  size: number;
  totalCount: number;
};

export type ShippingCompanyItem = {
  createdAt: string;
  id: number;
  linkedOrdersCount: number;
  name: string;
  updatedAt: string;
};

export type ShippingCompanyListResponse = {
  items: ShippingCompanyItem[];
};

export type ShippingCompanyMutationInput = {
  name: string;
};

export type ExpenseAccountItem = {
  id: number;
  accountingDate: string | null;
  accountingStatus: number;
  accountingStatusLabel: string;
  amount: number;
  reason: string;
  type: number;
  typeLabel: string;
};

export type ExpenseAccountsListResponse = {
  items: ExpenseAccountItem[];
  page: number;
  size: number;
  totalCount: number;
};

export type PerformanceOverview = {
  deliveredOrdersCount: number;
  totalGmv: number;
};

export type PerformanceChartItem = {
  deliveredOrdersCount: number;
  label: string;
};

export type PerformanceDeliveryProviderItem = {
  deliveredOrdersCount: number;
  deliveryBy: number | null;
  deliveryByLabel: string;
  returnsCount: number;
  shippingCompanyName: string;
  totalGmv: number;
};

export type PerformanceVendorItem = {
  deliveredOrdersCount: number;
  returnsCount: number;
  sellerName: string;
  totalGmv: number;
};

export type PerformanceResponse = {
  chart: PerformanceChartItem[];
  overview: PerformanceOverview;
  providers: PerformanceDeliveryProviderItem[];
  vendors: PerformanceVendorItem[];
};

export type LegacyShipmentResponse<TData = unknown> = {
  data?: TData;
  message?: string;
  status?: boolean;
  statusCode?: number;
};
