import { z } from "zod";

import { DEFAULT_PAGE_NUMBER, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ORDER_PRIORITY_KEYS } from "./order.constants";

const csvNumberString = z.string().trim().min(1);
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
  userId: z.coerce.number().int().positive().optional(),
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

export const orderMutationSchema = z.record(z.string(), z.unknown());

export const orderBulkUpdateSchema = z.object({
  orderData: orderMutationSchema,
  orderIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const orderBulkDeleteSchema = z.object({
  orderIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const orderNoteSchema = z.object({
  text: z.string().optional().default(""),
});
