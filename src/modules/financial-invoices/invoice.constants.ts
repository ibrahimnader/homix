export const INVOICE_STATUS = {
  DRAFT: "draft",
  FROZEN: "frozen",
  REVIEWED: "reviewed",
  TRANSFERRED: "transferred",
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];
export const INVOICE_STATUSES = Object.values(INVOICE_STATUS) as [InvoiceStatus, ...InvoiceStatus[]];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "معلّقة",
  frozen: "مجمدة",
  reviewed: "تمت المراجعة",
  transferred: "تم التحويل",
};

/** Statuses a vendor user may ever see (never drafts or frozen invoices). */
export const VENDOR_VISIBLE_STATUSES: InvoiceStatus[] = [INVOICE_STATUS.REVIEWED, INVOICE_STATUS.TRANSFERRED];

export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["reviewed"],
  frozen: ["reviewed"],
  reviewed: ["draft", "frozen", "transferred"],
  transferred: ["reviewed"],
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
export const BILLING_DAYS = [13, 28] as const;
