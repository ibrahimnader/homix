import { keepsSourcePendingForReason, reassignmentCandidateReason, sameReassignmentItem } from "./reassignment.logic";

const source = [{ productId: 17, sku: "CHAIR-BLUE", quantity: 2 }];
describe("shipment reassignment matching", () => {
  it("accepts only the same product, SKU and quantity", () => {
    expect(sameReassignmentItem(source, [{ ...source[0]! }])).toBe(true);
    expect(sameReassignmentItem(source, [{ ...source[0]!, productId: 18 }])).toBe(false);
    expect(sameReassignmentItem(source, [{ ...source[0]!, sku: "CHAIR-RED" }])).toBe(false);
    expect(sameReassignmentItem(source, [{ ...source[0]!, quantity: 1 }])).toBe(false);
    expect(sameReassignmentItem(source, [])).toBe(false);
  });
});

describe("shipment reassignment source status", () => {
  it("keeps the source pending only when the selected status says the customer still needs it", () => {
    expect(keepsSourcePendingForReason("إعادة تخصيص - العميل لسه محتاج الطلب")).toBe(true);
    expect(keepsSourcePendingForReason("ملغي - لا يوجد رد")).toBe(false);
  });
});

describe("reassignment candidate eligibility", () => {
  const base = { targetIsFinal: false, alreadyReassigned: false, sourceLines: source, targetLines: [{ ...source[0]! }] };
  it("returns null for a matching, open, unreassigned target", () => {
    expect(reassignmentCandidateReason(base)).toBeNull();
  });
  it("reports why a target is rejected, in POST check order", () => {
    expect(reassignmentCandidateReason({ ...base, targetIsFinal: true, alreadyReassigned: true })).toBe("final_status");
    expect(reassignmentCandidateReason({ ...base, alreadyReassigned: true })).toBe("already_reassigned");
    expect(reassignmentCandidateReason({ ...base, targetLines: [{ ...source[0]!, quantity: 9 }] })).toBe("item_mismatch");
  });
});
