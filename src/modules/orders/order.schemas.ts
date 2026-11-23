import { z } from "zod";

import { confirmRegressionSchema } from "./order-regression-guard";
import { DEFAULT_PAGE_NUMBER, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ORDER_PRIORITY_KEYS } from "./order.constants";

const csvNumberString = z.string().trim().min(1);
/* Comma-separated list of positive ints ("1,2"); a single value ("7") still works.
   Kept as a normalised string so it composes with the other csv filters. */
const csvPositiveIntString = z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(
  z.string().min(1).refine(
    (value) => value.split(",").every((item) => /^[1-9]\d*$/.test(item.trim())),
    "Expected a comma-separated list of positive integers",
  ),
).transform((value) => value.split(",").map((item) => item.trim()).join(","));
const dateString = z.string().trim().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "Invalid date value",
});
const csvPriorityString = z.string().trim().min(1).refine(
  (value) => value.split(",").every((item) => ORDER_PRIORITY_KEYS.includes(Number(item.trim()) as typeof ORDER_PRIORITY_KEYS[number])),
  "Invalid priority value",
);
const sortDirectionSchema = z.coerce.number().refine((value) => value === 1 || value === -1, "Sort direction must be 1 or -1");
const sortSchema = z.object({
  orderDate: sortDirectionSchema.optional(),
  priority: sortDirectionSchema.optional(),
  subTotalPrice: sortDirectionSchema.optional(),
  totalPrice: sortDirectionSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "sort must include at least one field").optional();

export const orderIdParamsSchema = z.object({
  orderId: z.coerce.number().int().positive(),
});

export const orderNoteParamsSchema = orderIdParamsSchema.extend({
  noteId: z.coerce.number().int().positive(),
});

export const orderListQuerySchema = z.object({
  confirmationStatus: csvNumberString.optional(),
  customerName: z.string().trim().optional(),
  deliveryBy: csvNumberString.optional(),
  deliveryStatus: csvNumberString.optional(),
  endDate: dateString.optional(),
  manufactureStatus: csvNumberString.optional(),
  operationCode: z.string().trim().optional(),
  orderSource: csvNumberString.optional(),
  orderNumber: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE_NUMBER),
  paymentStatus: csvNumberString.optional(),
  priority: csvPriorityString.optional(),
  productCode: z.string().trim().optional(),
  sort: sortSchema,
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  startDate: dateString.optional(),
  status: csvNumberString.optional(),
  userId: csvPositiveIntString.optional(),
  vendorId: csvNumberString.optional(),
  vendorName: z.string().trim().optional(),
});

export const orderSummaryQuerySchema = orderListQuerySchema.omit({
  page: true,
  sort: true,
  size: true,
});

export const orderFinancialReportQuerySchema = z.object({
  billingDay: z.coerce.number().refine((value) => value === 13 || value === 28, "billingDay must be 13 or 28").optional(),
  endDate: dateString.optional(),
  referenceDate: dateString.optional(),
  startDate: dateString.optional(),
  vendorId: z.union([z.coerce.number().int().positive(), z.string().trim().min(1)]).optional(),
});

export const orderExportQuerySchema = orderListQuerySchema.omit({
  page: true,
  size: true,
}).extend({
  financialStatus: z.string().trim().optional(),
});

/** Staff draft note printed on the invoice. Capped so it always fits the one-page invoice; null/"" clears it. */
export const INVOICE_NOTES_MAX_LENGTH = 1000;
export const invoiceNotesSchema = z.string().max(INVOICE_NOTES_MAX_LENGTH, `invoiceNotes must be at most ${INVOICE_NOTES_MAX_LENGTH} characters`).nullable();

/** `confirmRegression` (optional boolean) confirms an edit that moves a delivered/returned/replaced/in-inventory or invoiced order backwards. */
export const orderMutationSchema = z.record(z.string(), z.unknown()).refine(
  (value) => value.confirmRegression === undefined || confirmRegressionSchema.safeParse(value.confirmRegression).success,
  { message: "confirmRegression must be a boolean" },
).refine(
  (value) => value.invoiceNotes === undefined || invoiceNotesSchema.safeParse(value.invoiceNotes).success,
  { message: `invoiceNotes must be a string of at most ${INVOICE_NOTES_MAX_LENGTH} characters or null`, path: ["invoiceNotes"] },
);

export const orderBulkUpdateSchema = z.object({
  confirmRegression: confirmRegressionSchema.optional(),
  orderData: orderMutationSchema.refine((value) => value.invoiceNotes === undefined, {
    message: "invoiceNotes is edited per order, not in bulk",
    path: ["invoiceNotes"],
  }),
  orderIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const orderBulkDeleteSchema = z.object({
  orderIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const orderNoteSchema = z.object({
  text: z.string().optional().default(""),
});

export const orderSellerChatParamsSchema = orderIdParamsSchema.extend({
  messageId: z.coerce.number().int().positive(),
});

export const orderSellerChatMessageSchema = z.object({
  text: z.string().optional().default(""),
});

export const sellerChatQuickRepliesSchema = z.object({
  quickReplies: z.array(z.object({
    id: z.coerce.number().int().positive().optional(),
    label: z.string().trim().min(1),
  })).max(20),
});
