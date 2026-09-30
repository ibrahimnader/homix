import {
  buildAddressText,
  resolveDeliveryBy,
  resolveOrderGovernorate,
} from "./order-delivery-routing";

const { DELIVERY_BY } = require("../../../config/constants");

const insideCairo = { default_address: { address1: "١٢ ش مصطفى النحاس", city: "مدينة نصر", province: "القاهرة" } };
const outsideCairo = { default_address: { address1: "ش الجيش", city: "طنطا", province: "الغربية" } };

describe("buildAddressText", () => {
  it("flattens Shopify, manual and persisted address shapes", () => {
    expect(buildAddressText(insideCairo)).toContain("القاهرة");
    expect(buildAddressText({ address: "الدقي - الجيزة" })).toBe("الدقي - الجيزة");
    expect(buildAddressText(null)).toBe("");
  });
});

describe("resolveOrderGovernorate", () => {
  it("keeps an explicitly supplied governorate untouched", () => {
    expect(resolveOrderGovernorate("7", insideCairo)).toBe("7");
  });

  it("reads the governorate out of the address when none was supplied", () => {
    expect(resolveOrderGovernorate(null, insideCairo)).toBe("1");
    expect(resolveOrderGovernorate("", outsideCairo)).toBe("7");
  });

  it("returns null when the address names nothing recognizable", () => {
    expect(resolveOrderGovernorate(null, { address: "شارع ١٢ عمارة ٣" })).toBeNull();
  });
});

describe("resolveDeliveryBy", () => {
  it("is Homix when the order has more than one item", () => {
    expect(resolveDeliveryBy({
      governorate: "1",
      unitCount: 2,
      vendorIds: [4, 4],
    })).toBe(DELIVERY_BY.HOMIX);
  });

  it("is Homix when delivery is outside Cairo and Giza", () => {
    expect(resolveDeliveryBy({
      governorate: "7",
      unitCount: 1,
      vendorIds: [4],
    })).toBe(DELIVERY_BY.HOMIX);
  });

  it("is Homix when the items come from more than one vendor", () => {
    expect(resolveDeliveryBy({
      governorate: "2",
      unitCount: 1,
      vendorIds: [4, 9],
    })).toBe(DELIVERY_BY.HOMIX);
  });

  it("is vendor delivery for a single-vendor order inside Cairo or Giza", () => {
    expect(resolveDeliveryBy({
      governorate: "1",
      unitCount: 1,
      vendorIds: [4],
    })).toBe(DELIVERY_BY.VENDOR);

    expect(resolveDeliveryBy({
      governorate: "2",
      unitCount: 1,
      vendorIds: [4],
    })).toBe(DELIVERY_BY.VENDOR);
  });

  it("falls back to the address when no governorate is stored", () => {
    expect(resolveDeliveryBy({
      addressText: "الشيخ زايد، الجيزة",
      unitCount: 1,
      vendorIds: [4],
    })).toBe(DELIVERY_BY.VENDOR);

    expect(resolveDeliveryBy({
      addressText: "سموحة، الاسكندرية",
      unitCount: 1,
      vendorIds: [4],
    })).toBe(DELIVERY_BY.HOMIX);
  });

  it("defaults to Homix when the address names no governorate at all", () => {
    expect(resolveDeliveryBy({
      addressText: "شارع ١٢ عمارة ٣",
      unitCount: 1,
      vendorIds: [4],
    })).toBe(DELIVERY_BY.HOMIX);
  });
});
