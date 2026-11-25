import { z } from "zod";

import { BILLING_DAYS, INVOICE_STATUSES, LINE_ACTIONS } from "./invoice.constants";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ يجب أن يكون بصيغة YYYY-MM-DD");
const id = z.coerce.number().int().positive();
const money = z.number().finite().min(0).max(999_999_999.99);
const flag = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");
const statusList = z.string().transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
  .pipe(z.array(z.enum(INVOICE_STATUSES)));

const text = z.string().trim().min(1).max(100);
const idList = z.string().transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
  .pipe(z.array(z.coerce.number().int().positive()).min(1).max(200));

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
};

export const invoiceIdParams = z.object({ id });
export const invoiceLineParams = z.object({ id, lineId: id });
export const invoiceAdjustmentParams = z.object({ adjustmentId: id, id });

export const invoiceListQuery = z.object({
  ...paging,
  billingDay: z.coerce.number().int().refine((value) => (BILLING_DAYS as readonly number[]).includes(value), "billingDay must be 13 or 28").optional(),
  /** both = no direction filter (the default) */
  dueParty: z.enum(["vendor", "homix", "both"]).transform((value) => (value === "both" ? undefined : value)).optional(),
  invoiceCode: text.optional(),
  invoiceFrom: day.optional(),
  invoiceTo: day.optional(),
  kind: z.enum(["standard", "consolidated"]).optional(),
  /** Cairo calendar month of the invoice's cycle end (periodEnd), YYYY-MM */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "الشهر يجب أن يكون بصيغة YYYY-MM").optional(),
  overdue: flag.optional(),
  receipt: z.enum(["uploaded", "missing"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  status: statusList.optional(),
  transferredFrom: day.optional(),
  transferredTo: day.optional(),
  vendorId: id.optional(),
});

/** One billing cycle = the Cairo day its invoices end on (same value as the report's cycle.endDate). */
export const cycleQuery = z.object({ periodEnd: day, vendorId: id.optional() });

export const invoicedLinesQuery = z.object({
  ...paging,
  invoiceCode: text.optional(),
  operationNumber: text.optional(),
  orderNumber: text.optional(),
  productCode: text.optional(),
  q: text.optional(),
  /** one id or a comma separated list */
  vendorId: idList.optional(),
});

export const activityQuery = z.object({ ...paging, invoiceId: id.optional() });

export const reconciliationQuery = z.object({ from: day.optional(), to: day.optional() });
export const reconciliationBody = z.object({ bankTotal: money, from: day.optional(), to: day.optional() });

export const generateBody = z.object({
  billingDay: z.union([z.literal(13), z.literal(28)]),
  referenceDate: day.optional(),
  vendorId: id.optional(),
});

export const reviewLiveBody = z.object({
  billingDay: z.union([z.literal(13), z.literal(28)]),
  referenceDate: day.optional(),
  vendorId: id,
});

/** Live-row line actions: address the draft by (vendor, cycle) instead of an invoice id; the server creates the draft if needed. */
export const liveLineActionBody = reviewLiveBody.extend({
  action: z.enum(LINE_ACTIONS),
  orderId: id,
  reason: z.string().trim().max(500).optional(),
});
export const liveAddOrderBody = reviewLiveBody.extend({ orderId: id });
export const liveDraftBody = reviewLiveBody;
export const liveCandidatesQuery = z.object({ q: z.string().trim().min(1).max(100), vendorId: id });

export const reviewLiveAllBody = reviewLiveBody.omit({ vendorId: true });

export const transitionBody = z.object({
  to: z.enum(INVOICE_STATUSES),
  transferAmount: money.optional(),
});

export const bulkTransitionBody = z.object({
  ids: z.array(id).min(1).max(200),
  to: z.enum(["reviewed", "frozen", "transferred"]),
});

export const adjustmentBody = z.object({
  amount: money.refine((value) => value > 0, "المبلغ يجب أن يكون أكبر من صفر"),
  kind: z.enum(["addition", "deduction"]),
  label: z.string().trim().min(1).max(200),
});

export const lineOverrideBody = z.object({
  collectionOverride: money.nullable().optional(),
  companyDueOverride: money.nullable().optional(),
  finesOverride: money.nullable().optional(),
  reason: z.string().trim().max(500).optional(),
  vendorDueOverride: money.nullable().optional(),
  vendorShippingCostOverride: money.nullable().optional(),
  warehouseCostOverride: money.nullable().optional(),
}).refine(
  (value) => [value.collectionOverride, value.companyDueOverride, value.finesOverride, value.vendorDueOverride, value.vendorShippingCostOverride, value.warehouseCostOverride].some((field) => field !== undefined),
  "لا توجد تعديلات",
);

export const lineActionBody = z.object({
  action: z.enum(LINE_ACTIONS),
  reason: z.string().trim().max(500).optional(),
});

export const addOrderBody = z.object({ orderId: id });
export const candidatesQuery = z.object({ q: z.string().trim().min(1).max(100) });

export const invoiceReceiptParams = z.object({ id, receiptId: z.coerce.number().int().min(0) });

/** «فاتورة شاملة»: ≥ 2 distinct invoices of one vendor. */
export const consolidateBody = z.object({
  invoiceIds: z.array(id).min(2, "اختر فاتورتين على الأقل").max(50)
    .refine((ids) => new Set(ids).size === ids.length, "الفواتير المختارة مكررة"),
});
