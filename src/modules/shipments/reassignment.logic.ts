export type ReassignmentLine = { productId: number; sku: string | null; quantity: number };
export const CUSTOMER_STILL_NEEDS_REASON = "إعادة تخصيص - العميل لسه محتاج الطلب";
export const keepsSourcePendingForReason = (reason: string): boolean => reason.trim() === CUSTOMER_STILL_NEEDS_REASON;

export const sameReassignmentItem = (
  source: ReassignmentLine[], target: ReassignmentLine[],
): boolean => source.length === 1 && target.length === 1
  && Number(source[0]!.productId) === Number(target[0]!.productId)
  && String(source[0]!.sku ?? "").trim() === String(target[0]!.sku ?? "").trim()
  && Number(source[0]!.quantity) === Number(target[0]!.quantity);

export type ReassignmentCandidateReason = "final_status" | "already_reassigned" | "item_mismatch";
export const REASSIGNMENT_CANDIDATE_REASON_LABELS: Record<ReassignmentCandidateReason, string> = {
  final_status: "الطلب منتهي (ملغي/مسلّم/مسترجع)",
  already_reassigned: "الطلب سبق إعادة تخصيصه",
  item_mismatch: "المنتج أو SKU أو الكمية لا تطابق الطلب الأصلي",
};

/** Mirrors the POST eligibility checks for one candidate target; null means eligible. */
export const reassignmentCandidateReason = (input: {
  targetIsFinal: boolean;
  alreadyReassigned: boolean;
  sourceLines: ReassignmentLine[];
  targetLines: ReassignmentLine[];
}): ReassignmentCandidateReason | null => {
  if (input.targetIsFinal) return "final_status";
  if (input.alreadyReassigned) return "already_reassigned";
  if (!sameReassignmentItem(input.sourceLines, input.targetLines)) return "item_mismatch";
  return null;
};
