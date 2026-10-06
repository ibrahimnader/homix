import { z } from "zod";
import moment from "moment-timezone";

const ids = z
  .array(z.number().int().positive())
  .min(1)
  .max(100)
  .refine(
    (value) => new Set(value).size === value.length,
    "لا يمكن تكرار نفس الطلب"
  );
export const receivingCreateSchema = z.object({
  orderIds: ids,
  receivedDate: z
    .string()
    .refine(
      (value) => moment(value, "YYYY-MM-DD", true).isValid(),
      "تاريخ غير صالح"
    )
    .refine(
      (value) => value <= moment().tz("Africa/Cairo").format("YYYY-MM-DD"),
      "تاريخ الاستلام لا يمكن أن يكون في المستقبل"
    ),
  notes: z.string().trim().max(4000).default(""),
  senderName: z.string().trim().max(200).default(""),
});
export const receivingDocumentSchema = z.object({ orderIds: ids });
export const receivingListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(150).default(""),
  date: z
    .string()
    .refine(
      (value) => moment(value, "YYYY-MM-DD", true).isValid(),
      "تاريخ غير صالح"
    )
    .optional(),
});
export const receivingDocumentParams = z.object({
  number: z.string().trim().min(1),
});
