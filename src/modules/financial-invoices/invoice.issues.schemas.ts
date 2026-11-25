import moment from "moment-timezone";
import { z } from "zod";

import { BILLING_DAYS } from "./invoice.constants";

export const issuesQuery = z.object({
  billingDay: z.coerce.number().int().refine((value) => (BILLING_DAYS as readonly number[]).includes(value), "billingDay must be 13 or 28").optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "الشهر يجب أن يكون بصيغة YYYY-MM").optional(),
  vendorId: z.coerce.number().int().positive().optional(),
});
export type IssuesQuery = z.infer<typeof issuesQuery>;

/** ISO date-time, or a plain YYYY-MM-DD read as a Cairo calendar day (start / end of that day). */
const cairoBoundary = (edge: "start" | "end") => z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? moment.tz(value, "YYYY-MM-DD", "Africa/Cairo").isValid() : z.string().datetime({ offset: true }).safeParse(value).success,
  "التاريخ غير صالح",
).transform((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const day = moment.tz(value, "YYYY-MM-DD", "Africa/Cairo");
  return (edge === "start" ? day.startOf("day") : day.endOf("day")).toISOString();
});

export const pendingShipmentsQuery = z.object({
  endDate: cairoBoundary("end"),
  startDate: cairoBoundary("start"),
  vendorId: z.coerce.number().int().positive().optional(),
});
export type PendingShipmentsQuery = z.infer<typeof pendingShipmentsQuery>;
