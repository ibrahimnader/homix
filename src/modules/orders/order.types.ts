import type { Request } from "express";

import type { ORDER_PRIORITY_KEYS, ORDER_SUMMARY_CARD_KEYS } from "./order.constants";
export type OrderSummaryCardKey = (typeof ORDER_SUMMARY_CARD_KEYS)[number];

export type OrderRequestUser = NonNullable<Request["user"]>;

export type OrderPriorityKey = (typeof ORDER_PRIORITY_KEYS)[number];

export type OrderListQuery = {
  customerName?: string;
  deliveryBy?: string;
  deliveryStatus?: string;
  endDate?: string;
  manufactureStatus?: string;
  operationCode?: string;
  orderSource?: string;
  orderNumber?: string;
  page: number;
  paymentStatus?: string;
  priority?: string;
  productCode?: string;
  sort?: Partial<Record<"orderDate" | "priority" | "subTotalPrice" | "totalPrice", 1 | -1>>;
  size: number;
  startDate?: string;
  status?: string;
  userId?: number;
  vendorId?: string;
  vendorName?: string;
};

export type OrderSummaryQuery = Omit<OrderListQuery, "page" | "size">;

export type OrderFinancialReportQuery = {
  billingDay?: 13 | 28;
  endDate?: string;
  referenceDate?: string;
  startDate?: string;
  vendorId?: string | number;
};

export type OrderListItem = {
  assigneeId: number | null;
  code: string;
  customerName: string;
  daysSinceOrder: number | null;
  deliveryPriority: OrderPriorityKey | null;
  deliveryPriorityLabel: string;
  deliveryStatus: number | null;
  priority: OrderPriorityKey | null;
  priorityLabel: string;
  deliveryBy: number | null;
  deliveryByLabel: string;
  expectedDeliveryDate: string | null;
  fine: number;
  id: number;
  manufactureStatus: number | null;
  manufactureStatusLabel: string;
  operationNumber: string;
  orderSource: number | null;
  orderSourceLabel: string;
  orderDate: string | null;
  orderNumber: string;
  paymentStatus: number | null;
  paymentStatusLabel: string;
  productCode: string;
  productImage: string;
  itemType: string;
  productName: string;
  status: number | null;
  statusLabel: string;
  toBeCollected: number;
  totalCost: number;
  totalPrice: number;
  userName: string;
  vendorId: number | null;
  vendorName: string;
};

export type OrderListResponse = {
  items: OrderListItem[];
  page: number;
  size: number;
  totalCount: number;
};

export type OrderSummaryCard = {
  key: OrderSummaryCardKey;
  label: string;
  value: number;
};

export type OrderSummaryResponse = {
  cards: OrderSummaryCard[];
};

export type OrderFinancialReportVendorRow = {
  collectionTotal: number;
  companyDue: number;
  fines: number;
  orders: OrderFinancialReportOrderRow[];
  ordersCount: number;
  vendorDue: number;
  vendorId: number | null;
  vendorName: string;
  /** مجموع «شحن المورد» لطلبات هذا البائع */
  vendorShippingCost: number;
  warehouseCost: number;
};

export type OrderFinancialReportOrderRow = {
  collectionTotal: number;
  companyDue: number;
  fines: number;
  id: number;
  operationNumber: string;
  orderId: number;
  orderNumber: string;
  paymentStatus: number | null;
  paymentStatusLabel: string;
  productCode: string;
  productId: number | null;
  shipmentId: number | null;
  vendorDue: number;
  vendorShippingCost: number;
  warehouseCost: number;
};

export type OrderFinancialReportSectionSummary = {
  collectionTotal: number;
  companyDue: number;
  fines: number;
  ordersCount: number;
  vendorDue: number;
  /** مجموع «شحن المورد» — يخصّ تسليمات البائع فقط */
  vendorShippingCost: number;
  warehouseCost: number;
};

export type OrderFinancialReportSection = {
  items: OrderFinancialReportVendorRow[];
  summary: OrderFinancialReportSectionSummary;
};

export type OrderFinancialReportResponse = {
  cycle: {
    billingDay: 13 | 28;
    endDate: string;
    mode: "billingCycle" | "customRange";
    referenceDate: string;
    startDate: string;
  };
  fullInvoice: OrderFinancialReportSection;
  summary: {
    companyDue: number;
    fines: number;
    totalSales: number;
    vendorDue: number;
    vendorsCount: number;
  };
  vendorDeliveries: OrderFinancialReportSection;
  warehouseDeliveries: OrderFinancialReportSection;
};

export type OrderMetaOption = {
  id: number | string;
  label: string;
};

export type OrderMetaResponse = {
  assignees: OrderMetaOption[];
  deliveryByOptions: OrderMetaOption[];
  manufactureStatuses: OrderMetaOption[];
  orderSources: OrderMetaOption[];
  paymentStatuses: OrderMetaOption[];
  priorities: OrderMetaOption[];
  statuses: OrderMetaOption[];
  vendors: OrderMetaOption[];
};

export type OrderAttachment = {
  createdAt: string;
  description: string;
  id: number;
  name: string;
  url: string;
};

export type OrderNote = {
  attachments: OrderAttachment[];
  createdAt: string;
  id: number;
  text: string;
  userName: string;
};

export type OrderTimelineItem = {
  changedAt: string;
  description: string;
  eventType: string;
  fromStatus: number | null;
  fromStatusLabel: string;
  id: number;
  message: string;
  toStatus: number | null;
  toStatusLabel: string;
  userName: string;
};

export type OrderStatusHistoryItem = {
  changedAt: string;
  id: number;
  isActive: boolean;
  status: number | null;
  statusLabel: string;
  userName: string;
};

export type OrderDetailsView = {
  assigneeId: number | null;
  assigneeName: string;
  customer: {
    id: number | null;
    address: string;
    email: string;
    name: string;
    phoneNumber: string;
  };
  financial: {
    amountToCollect: number;
    commission: number;
    discount: number;
    downPayment: number;
    fine: number;
    shippingFees: number;
    subTotalPrice: number;
    totalCost: number;
    totalPrice: number;
  };
  notes: OrderNote[];
  order: OrderListItem & {
    deliveryStatus: number | null;
    deliveryDate: string | null;
    itemsCount: number;
    notes: string;
    shippedFromInventory: boolean;
    shipmentType: string;
  };
  items: Array<{
    color: string;
    id: number;
    image: string;
    itemType: string;
    material: string;
    price: number;
    productId: number | null;
    productName: string;
    quantity: number;
    size: string;
    sku: string;
    typeName: string;
    unitCost: number;
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
    vendorId: number | null;
    vendorName: string;
  }>;
  timeline: OrderTimelineItem[];
  statusHistory: OrderStatusHistoryItem[];
};

export type OrderDetailsResponse = OrderDetailsView;

export type OrderMutationPayload = Record<string, unknown>;

export type LegacyOrderResponse<TData = unknown> = {
  data?: TData;
  message?: string;
  status?: boolean;
  statusCode?: number;
};
