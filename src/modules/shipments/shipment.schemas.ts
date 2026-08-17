import { z } from "zod";

import { DEFAULT_PAGE_NUMBER, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PERFORMANCE_PERIODS } from "./shipment.constants";
import { isValidDateInput } from "./shipment.helpers";

const csvString = z.string().trim().min(1);
const dateString = z.string().trim().refine(isValidDateInput, {
  message: "Invalid date value",
});
const sortDirectionSchema = z.coerce.number().refine((value) => value === 1 || value === -1, "Sort direction must be 1 or -1");
const sortSchema = z.object({
  orderDate: sortDirectionSchema.optional(),
  priority: sortDirectionSchema.optional(),
  subTotalPrice: sortDirectionSchema.optional(),
  totalPrice: sortDirectionSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "sort must include at least one field").optional();

export const shipmentIdParamsSchema = z.object({
  shipmentId: z.coerce.number().int().positive(),
});

export const shipmentShippingCompanyParamsSchema = z.object({
  shippingCompanyId: z.coerce.number().int().positive(),
});

export const shipmentInventoryItemParamsSchema = z.object({
  inventoryItemId: z.coerce.number().int().positive(),
});

export const shipmentExpenseParamsSchema = z.object({
  expenseId: z.coerce.number().int().positive(),
});

export const shipmentReturnParamsSchema = z.object({
  returnId: z.coerce.number().int().positive(),
});

export const shipmentNoteParamsSchema = shipmentIdParamsSchema.extend({
  noteId: z.coerce.number().int().positive(),
});

export const shipmentListQuerySchema = z.object({
  customerName: z.string().trim().optional(),
  customerPhone: z.string().trim().optional(),
  deliveryBy: z.string().trim().optional(),
  deliveryStatus: csvString.optional(),
  deliveryDateFrom: dateString.optional(),
  deliveryDateTo: dateString.optional(),
  endDate: dateString.optional(),
  governorate: csvString.optional(),
  operationCode: z.string().trim().optional(),
  orderSource: csvString.optional(),
  orderNumber: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE_NUMBER),
  paymentStatus: csvString.optional(),
  priority: csvString.optional(),
  scheduleStatus: csvString.optional(),
  scheduledDateFrom: dateString.optional(),
  scheduledDateTo: dateString.optional(),
  shippingCompany: csvString.optional(),
  shipmentNumber: z.string().trim().optional(),
  shipmentStatus: csvString.optional(),
  shipmentType: csvString.optional(),
  sort: sortSchema,
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  startDate: dateString.optional(),
  vendorName: z.string().trim().optional(),
});

export const shipmentSummaryQuerySchema = shipmentListQuerySchema.omit({
  page: true,
  sort: true,
  size: true,
});

export const shipmentExportQuerySchema = shipmentListQuerySchema.omit({
  customerName: true,
  customerPhone: true,
  deliveryBy: true,
  deliveryDateFrom: true,
  deliveryDateTo: true,
  governorate: true,
  operationCode: true,
  orderSource: true,
  page: true,
  priority: true,
  scheduleStatus: true,
  scheduledDateFrom: true,
  scheduledDateTo: true,
  shipmentNumber: true,
  shipmentStatus: true,
  shipmentType: true,
  size: true,
}).extend({
  financialStatus: z.string().trim().optional(),
});

const shipmentCreateLineItemSchema = z.object({
  price: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().int().positive(),
  title: z.string().trim().min(1),
  variant_id: z.union([z.string().trim().min(1), z.coerce.number().int().positive()]),
}).passthrough();

export const shipmentCreateSchema = z.object({
  code: z.union([z.string().trim().min(1), z.coerce.number().int().positive()]).optional(),
  customer: z.object({}).passthrough(),
  deliveryBy: z.coerce.number().int().positive().optional().nullable(),
  deliveryDate: dateString.optional().nullable(),
  downPayment: z.coerce.number().min(0).optional(),
  expectedDate: dateString.optional().nullable(),
  expectedDeliveryDate: dateString.optional().nullable(),
  governorate: z.string().trim().min(1).optional().nullable(),
  itemShipping: z.coerce.number().min(0).optional(),
  line_items: z.array(shipmentCreateLineItemSchema).min(1, "line_items must contain at least one item"),
  name: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional().nullable(),
  number: z.union([z.string().trim().min(1), z.coerce.number().int().positive()]).optional(),
  orderSource: z.coerce.number().int().positive().optional().nullable(),
  order_number: z.union([z.string().trim().min(1), z.coerce.number().int().positive()]).optional(),
  orderDate: dateString.optional().nullable(),
  paymentStatus: z.coerce.number().int().positive().optional().nullable(),
  PoDate: dateString.optional().nullable(),
  priority: z.coerce.number().int().min(1).max(3).optional().nullable(),
  receivedAmount: z.coerce.number().min(0).optional(),
  scheduleStatus: z.coerce.number().int().positive().optional().nullable(),
  shipmentStatus: z.coerce.number().int().positive().optional().nullable(),
  shipmentType: z.string().trim().min(1).optional().nullable(),
  shippedFromInventory: z.boolean().optional(),
  shippingCompany: z.coerce.number().int().positive().optional().nullable(),
  shippingFees: z.coerce.number().min(0).optional(),
  shippingReceiveDate: dateString.optional().nullable(),
  toBeCollected: z.coerce.number().min(0).optional(),
}).passthrough().superRefine((value, context) => {
  const customer = value.customer as Record<string, unknown>;
  const hasCustomerIdentity = Boolean(
    customer.id
    || customer.firstName
    || customer.first_name
    || customer.default_address,
  );

  if (!hasCustomerIdentity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "customer must include id, name fields, or default_address",
      path: ["customer"],
    });
  }
});

export const shipmentMutationSchema = z.record(z.string(), z.unknown());

/* Bulk edit only ever exposes these five fields in the UI, so — unlike the
   single-shipment edit, which is a free-form passthrough — this is an explicit
   allow-list: touching many rows at once deserves tighter validation. */
export const shipmentBulkUpdateSchema = z.object({
  data: z.object({
    deliveryBy: z.coerce.number().int().positive().optional(),
    governorate: z.string().trim().optional(),
    shipmentStatus: z.coerce.number().int().positive().optional(),
    shipmentType: z.string().trim().optional(),
    userId: z.coerce.number().int().positive().optional(),
  }).refine((value) => Object.keys(value).length > 0, "No fields to update"),
  shipmentIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const shipmentNoteSchema = z.object({
  text: z.string().optional().default(""),
});

export const shipmentReturnsQuerySchema = z.object({
  operationCode: z.string().trim().optional(),
  orderNumber: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE_NUMBER),
  sellerName: z.string().trim().optional(),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.coerce.number().int().positive().optional(),
});

export const shipmentReturnsExportQuerySchema = shipmentReturnsQuerySchema.omit({
  page: true,
  size: true,
});

export const shipmentReturnMutationSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1),
  returnDate: dateString.optional().nullable(),
  status: z.coerce.number().int().positive().optional(),
});

/**
 * Updates accept an empty reason: clearing the field is a deliberate action, and
 * `.partial()` alone still ran the create rule's min(1) whenever the key was sent.
 */
export const shipmentReturnUpdateSchema = shipmentReturnMutationSchema.partial().extend({
  reason: z.string().trim().optional(),
});

export const shipmentInventoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE_NUMBER),
  productCode: z.string().trim().optional(),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.coerce.number().int().positive().optional(),
  vendorName: z.string().trim().optional(),
});

export const shipmentInventoryExportQuerySchema = shipmentInventoryQuerySchema.omit({
  page: true,
  size: true,
});

export const shipmentInventoryMutationSchema = z.object({
  color: z.string().trim().optional(),
  costPrice: z.coerce.number().min(0),
  productId: z.coerce.number().int().positive(),
  productCode: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(0),
  size: z.string().trim().optional(),
  status: z.coerce.number().int().positive().optional(),
});

export const shipmentDeliveryAccountsQuerySchema = z.object({
  accountingStatus: z.coerce.number().int().positive().optional(),
  orderNumber: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE_NUMBER),
  paymentMethod: z.string().trim().optional(),
  settledDate: dateString.optional(),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const shipmentDeliveryAccountsExportQuerySchema = shipmentDeliveryAccountsQuerySchema.omit({
  page: true,
  size: true,
});

export const shipmentDeliveryAccountParamsSchema = z.object({
  orderId: z.coerce.number().int().positive(),
});

export const shipmentDeliveryAccountMutationSchema = z.object({
  accountingDate: dateString.optional().nullable(),
  accountingReference: z.string().trim().optional(),
  accountingStatus: z.coerce.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, "No fields to update");

export const shipmentDeliveryAccountBulkMutationSchema = z.object({
  data: shipmentDeliveryAccountMutationSchema,
  orderIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const shipmentExpenseAccountsQuerySchema = z.object({
  accountingStatus: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE_NUMBER),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  type: z.coerce.number().int().positive().optional(),
});

export const shipmentExpenseAccountsExportQuerySchema = shipmentExpenseAccountsQuerySchema.omit({
  page: true,
  size: true,
});

export const shipmentExpenseMutationSchema = z.object({
  accountingDate: dateString.optional().nullable(),
  accountingStatus: z.coerce.number().int().positive().optional(),
  amount: z.coerce.number().min(0),
  reason: z.string().trim().min(1),
  type: z.coerce.number().int().positive(),
});

export const shipmentExpenseTypesMutationSchema = z.object({
  options: z.array(z.object({
    id: z.coerce.number().int().positive().optional(),
    label: z.string().trim().min(1).max(150),
  })).min(1).max(100),
});

export const shipmentPerformanceQuerySchema = z.object({
  endDate: dateString.optional(),
  period: z.enum(PERFORMANCE_PERIODS).default("daily"),
  startDate: dateString.optional(),
});

export const shipmentShippingCompaniesQuerySchema = z.object({
  search: z.string().trim().optional(),
});

export const shipmentShippingCompanyMutationSchema = z.object({
  name: z.string().trim().min(1),
});
