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
