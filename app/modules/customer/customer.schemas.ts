import { z } from "zod";

const positiveIntegerMessage = "Expected a positive integer";

const optionalCustomerString = z.union([z.string(), z.null()]).optional().transform((value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});

export const customerIdParamsSchema = z.object({
  customerId: z.coerce.number().int().positive(positiveIntegerMessage),
});

export const customerUpdateSchema = z.object({
  address: optionalCustomerString,
  address2: optionalCustomerString,
  email: optionalCustomerString,
  firstName: optionalCustomerString,
  lastName: optionalCustomerString,
  phoneNumber: optionalCustomerString,
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "At least one customer field is required" },
);

export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().optional(),
  size: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["recent", "spend", "orders"]).default("recent"),
});

export const customerExportQuerySchema = customerListQuerySchema.omit({
  page: true,
  size: true,
});

export const customerCreateSchema = z.object({
  address: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  firstName: z.string().trim().min(1, "الاسم الأول مطلوب"),
  lastName: z.string().trim().optional().default(""),
  phoneNumber: z.string().trim().min(1, "رقم الموبايل مطلوب"),
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
