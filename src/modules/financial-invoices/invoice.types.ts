import type { InvoiceStatus, LineState } from "./invoice.constants";

/** Raw DB rows (NUMERIC columns arrive from pg as strings). */
export type InvoiceRow = {
  id: number | string;
  code: string | null;
  vendorId: number;
  vendorName?: string | null;
  billingDay: number;
  periodStart: Date | string;
  periodEnd: Date | string;
  status: InvoiceStatus;
  ordersCount: number;
  collectionTotal: string | number;
  warehouseCost: string | number;
  vendorShippingCost: string | number;
  finesTotal: string | number;
  vendorDueTotal: string | number;
  companyDueTotal: string | number;
  adjustmentsTotal: string | number;
  netAmount: string | number;
  reviewedAt: Date | string | null;
  frozenAt: Date | string | null;
  frozenDurationMs: string | number;
  transferredAt: Date | string | null;
  transferAmount: string | number | null;
  receiptPath: string | null;
  receiptName: string | null;
  receiptMime: string | null;
  receiptUploadedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type LineRow = {
  id: number | string;
  invoiceId: number | string;
  orderId: number;
  operationNumber: string;
  orderNumber: string;
  productCode: string;
  paymentStatus: number | null;
  paymentStatusLabel: string;
  isWarehouseDelivery: boolean;
  collectionTotal: string | number;
  warehouseCost: string | number;
  fines: string | number;
  vendorShippingCost: string | number;
  vendorDue: string | number;
  companyDue: string | number;
  finesOverride: string | number | null;
  warehouseCostOverride?: string | number | null;
  vendorShippingCostOverride?: string | number | null;
  companyDueKind?: "margin" | "vendorOwes" | null;
  collectionOverride?: string | number | null;
  vendorDueOverride: string | number | null;
  companyDueOverride: string | number | null;
  overrideReason: string | null;
  state: LineState;
  stateReason: string | null;
  stateChangedAt: Date | string | null;
};

export type AdjustmentRow = {
  id: number | string;
  invoiceId: number | string;
  label: string;
  kind: "addition" | "deduction";
  amount: string | number;
  createdAt: Date | string;
  removedAt: Date | string | null;
};

/** Snapshot of one order as computed by the live financial report. */
export type LineSnapshot = {
  orderId: number;
  operationNumber: string;
  orderNumber: string;
  productCode: string;
  paymentStatus: number | null;
  paymentStatusLabel: string;
  isWarehouseDelivery: boolean;
  collectionTotal: number;
  warehouseCost: number;
  fines: number;
  vendorShippingCost: number;
  vendorDue: number;
  companyDue: number;
  /** margin = Homix delivered (collection − cost); vendorOwes = vendor delivered (debt to Homix) */
  companyDueKind: "margin" | "vendorOwes" | null;
};

export type InvoiceTotals = {
  ordersCount: number;
  collectionTotal: number;
  warehouseCost: number;
  vendorShippingCost: number;
  finesTotal: number;
  vendorDueTotal: number;
  companyDueTotal: number;
  adjustmentsTotal: number;
  netAmount: number;
};

export type Actor = { id: number };
