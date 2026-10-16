import { sameReassignmentItem } from "./reassignment.logic";

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
