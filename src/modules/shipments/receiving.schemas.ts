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
const isoDay = z
  .string()
  .refine((value) => moment(value, "YYYY-MM-DD", true).isValid(), "تاريخ غير صالح");
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
const optionalText = z.string().trim().max(150).optional();
const optionalVendorId = z.coerce.number().int().positive().optional();
/** Not-yet-received candidates: the combined `search` plus one dedicated filter per field. */
export const receivingCandidatesSchema = receivingListSchema.extend({
  sku: optionalText,
  operationNumber: optionalText,
  orderNumber: optionalText,
  vendorId: optionalVendorId,
});
// Filters for the "received" list and its export. Each is applied server-side
// so results stay correct across pages.
export const receivingReceivedFilterSchema = receivingListSchema.extend({
  sku: optionalText,
  operationNumber: optionalText,
  orderNumber: optionalText,
  vendorId: optionalVendorId,
  documentNumber: optionalText,
  /** issued = a receipt voucher was printed for the item; none = not printed yet. */
  documentState: z.enum(["issued", "none"]).optional(),
  dateFrom: isoDay.optional(),
  dateTo: isoDay.optional(),
});
export const MANUFACTURE_DATE_AUTOMATIC_MESSAGE =
  "تاريخ التصنيع يُسجَّل تلقائيًا عند تحويل الطلب لقيد التصنيع ولا يُعدَّل يدويًا";

/** Inline edits of an already received item (receipt notes / receipt date). The manufacture date is automatic and read-only. */
export const receivingUpdateSchema = z
  .object({
    notes: z.string().trim().max(4000).optional(),
    receiptDate: isoDay.optional(),
    manufactureDate: z
      .unknown()
      .refine((value) => value === undefined, MANUFACTURE_DATE_AUTOMATIC_MESSAGE),
  })
  .refine(
    (value) => value.notes !== undefined || value.receiptDate !== undefined || value.manufactureDate !== undefined,
    "لا توجد تعديلات"
  );
export const receivingExportSchema = receivingReceivedFilterSchema.omit({ page: true });
export const receivingDocumentParams = z.object({
  number: z.string().trim().min(1),
});
