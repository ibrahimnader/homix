import { resolveExportGovernorateLabel } from "./order-export-governorate";

describe("resolveExportGovernorateLabel", () => {
  it("shows the stored governorate id as its Arabic name", () => {
    expect(resolveExportGovernorateLabel("1", "anything")).toBe("القاهرة");
    expect(resolveExportGovernorateLabel(31, null)).toBe("كفر الشيخ");
  });

  it("keeps a legacy stored text value", () => {
    expect(resolveExportGovernorateLabel("القاهرة الجديدة", null)).toBe("القاهرة الجديدة");
  });

  it("falls back to the customer's address when nothing is stored (display only)", () => {
    expect(resolveExportGovernorateLabel(null, "Villa 5, Rehab City, Egypt")).toBe("القاهرة");
    expect(resolveExportGovernorateLabel("", "جسر السويس")).toBe("القاهرة");
  });

  it("is empty when there is neither a stored value nor a readable address", () => {
    expect(resolveExportGovernorateLabel(null, "استلام فرع")).toBe("");
    expect(resolveExportGovernorateLabel(undefined, undefined)).toBe("");
  });
});
