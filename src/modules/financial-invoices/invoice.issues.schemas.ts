import { z } from "zod";

import { BILLING_DAYS } from "./invoice.constants";

export const issuesQuery = z.object({
  billingDay: z.coerce.number().int().refine((value) => (BILLING_DAYS as readonly number[]).includes(value), "billingDay must be 13 or 28").optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "الشهر يجب أن يكون بصيغة YYYY-MM").optional(),
  vendorId: z.coerce.number().int().positive().optional(),
});
export type IssuesQuery = z.infer<typeof issuesQuery>;
