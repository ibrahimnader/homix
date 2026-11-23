import {
  costChanged,
  duplicateSkuBase,
  generateUniqueSku,
  parseLocalProductKey,
  randomSkuBase,
  toLocalProductKey,
} from "../../app/modules/product/product.system";
import {
  createSystemProductSchema,
  duplicateProductSchema,
} from "../../app/modules/product/product.schemas";

describe("local product keys", () => {
  it("round-trips and ignores Shopify ids", () => {
    expect(toLocalProductKey(12)).toBe("local:12");
    expect(parseLocalProductKey("local:12")).toBe(12);
    expect(parseLocalProductKey("7001")).toBeNull();
    expect(parseLocalProductKey("custom")).toBeNull();
    expect(parseLocalProductKey("local:abc")).toBeNull();
  });
});

describe("sku generation", () => {
  it("strips a previous -C<n> suffix", () => {
    expect(duplicateSkuBase("RKA-001-C3", "X")).toBe("RKA-001");
    expect(duplicateSkuBase("", "FALLBACK")).toBe("FALLBACK");
  });

  it("picks the first free suffix and honours reserved codes", async () => {
    const taken = new Set(["a-c1"]);
    const sku = await generateUniqueSku("A", async (candidate) => taken.has(candidate.toLowerCase()), new Set(["a-c2"]));
    expect(sku).toBe("A-C3");
  });

  it("can try the base itself first", async () => {
    await expect(generateUniqueSku("A", async () => false, new Set(), { tryBaseFirst: true })).resolves.toBe("A");
  });

  it("random base has the SYS- format", () => {
    expect(randomSkuBase(() => 0.5)).toMatch(/^SYS-[0-9A-Z]{6}$/);
  });
});

describe("costChanged", () => {
  it("ignores unsent and equal costs", () => {
    expect(costChanged(undefined, 5)).toBe(false);
    expect(costChanged(100, "100.00")).toBe(false);
    expect(costChanged(101, 100)).toBe(true);
    expect(costChanged(5, undefined)).toBe(true);
  });
});

describe("product schemas", () => {
  const variant = { price: 10 };
  it("accepts a minimal create body and rejects unknown keys", () => {
    expect(createSystemProductSchema.safeParse({ title: "ا", vendorId: 1, variants: [variant] }).success).toBe(true);
    expect(createSystemProductSchema.safeParse({ title: "ا", vendorId: 1, variants: [variant], shopifyId: "1" }).success).toBe(false);
  });
  it("requires title, vendor, at least one variant and a non-negative price", () => {
    expect(createSystemProductSchema.safeParse({ title: " ", vendorId: 1, variants: [variant] }).success).toBe(false);
    expect(createSystemProductSchema.safeParse({ title: "ا", variants: [variant] }).success).toBe(false);
    expect(createSystemProductSchema.safeParse({ title: "ا", vendorId: 1, variants: [] }).success).toBe(false);
    expect(createSystemProductSchema.safeParse({ title: "ا", vendorId: 1, variants: [{ price: -1 }] }).success).toBe(false);
  });
  it("rejects repeated codes inside one product (case-insensitive)", () => {
    const body = { title: "ا", vendorId: 1, variants: [{ price: 1, sku: "A" }, { price: 1, sku: "a" }] };
    expect(createSystemProductSchema.safeParse(body).success).toBe(false);
  });
  it("duplicate accepts an empty body", () => {
    expect(duplicateProductSchema.safeParse({}).success).toBe(true);
    expect(duplicateProductSchema.safeParse({ title: "" }).success).toBe(false);
  });
});
