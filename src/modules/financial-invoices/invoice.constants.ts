export const INVOICE_STATUS = {
  DRAFT: "draft",
  FROZEN: "frozen",
  REVIEWED: "reviewed",
  TRANSFERRED: "transferred",
  /** a source invoice merged into a consolidated invoice (its lines/adjustments live on the consolidated one) */
  CONSOLIDATED: "consolidated",
  /** a consolidated invoice that was undone (kept for the audit trail only) */
  CANCELLED: "cancelled",
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];
export const INVOICE_STATUSES = Object.values(INVOICE_STATUS) as [InvoiceStatus, ...InvoiceStatus[]];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "معلّقة",
  frozen: "مجمدة",
  reviewed: "تمت المراجعة",
  transferred: "تم التحويل",
  consolidated: "مدمجة في فاتورة شاملة",
  cancelled: "ملغاة",
};

export const INVOICE_KIND = { STANDARD: "standard", CONSOLIDATED: "consolidated" } as const;
export type InvoiceKind = (typeof INVOICE_KIND)[keyof typeof INVOICE_KIND];

/** Statuses that never show up in the normal archive lists / errors check (they only live inside a consolidated invoice or the audit log). */
export const HIDDEN_STATUSES: InvoiceStatus[] = ["consolidated", "cancelled"];
/** Only these invoices can be merged into a consolidated invoice. */
export const MERGEABLE_STATUSES: InvoiceStatus[] = ["draft", "reviewed"];
export const CONSOLIDATED_CODE_SUFFIX = "-ALL";

/**
 * Status label that follows the direction of the net: a transferred invoice with net > 0 was paid to the vendor,
 * with net < 0 the transfer was received from the vendor (net 0 keeps the neutral label).
 */
export const invoiceStatusLabel = (status: InvoiceStatus, netAmount: number): string => {
  if (status === "transferred") {
    if (netAmount > 0) return "تم التحويل للبائع";
    if (netAmount < 0) return "تم استلام التحويل من البائع";
  }
  return INVOICE_STATUS_LABELS[status];
};

/** Direction label of a signed net (> 0 Homix owes the vendor, < 0 the vendor owes Homix, 0 settled). */
export const netDirectionLabel = (netAmount: number): string =>
  netAmount > 0 ? "صافي المستحق للبائع" : netAmount < 0 ? "صافي المستحق لهوميكس" : "لا يوجد مستحق";

/** Statuses a vendor user may ever see (never drafts or frozen invoices). */
export const VENDOR_VISIBLE_STATUSES: InvoiceStatus[] = [INVOICE_STATUS.REVIEWED, INVOICE_STATUS.TRANSFERRED];

export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["reviewed"],
  frozen: ["reviewed"],
  reviewed: ["draft", "frozen", "transferred"],
  transferred: ["reviewed"],
  consolidated: [],
  cancelled: [],
};

export const LINE_STATE = {
  DEFERRED: "deferred",
  FROZEN: "frozen",
  INCLUDED: "included",
  REMOVED: "removed",
} as const;
export type LineState = (typeof LINE_STATE)[keyof typeof LINE_STATE];

export const LINE_ACTIONS = ["defer", "freeze", "unfreeze", "delete", "restore"] as const;
export type LineAction = (typeof LINE_ACTIONS)[number];

/** action -> [allowed current states, resulting state] */
export const LINE_ACTION_RULES: Record<LineAction, { from: LineState[]; to: LineState }> = {
  defer: { from: ["included", "frozen"], to: "deferred" },
  delete: { from: ["included", "frozen", "deferred"], to: "removed" },
  freeze: { from: ["included"], to: "frozen" },
  restore: { from: ["deferred", "frozen"], to: "included" },
  unfreeze: { from: ["frozen"], to: "included" },
};

/** A reviewed invoice not transferred after this many (non-frozen) days is overdue. */
export const OVERDUE_DAYS = 3;

export const RECEIPT_FOLDER = "financial-receipts";
/** Transfer receipts per invoice, and files accepted by one upload request. */
export const MAX_RECEIPTS_PER_INVOICE = 20;
export const MAX_RECEIPTS_PER_UPLOAD = 10;
export const BILLING_DAYS = [13, 28] as const;
