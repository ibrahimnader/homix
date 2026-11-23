import { calculateVendorDeliverySettlement, calculateWarehouseDeliverySettlement } from "./order-financial-settlement";

describe("calculateVendorDeliverySettlement", () => {
  it("makes a positive balance due to Homix (the vendor owes Homix)", () => {
    expect(calculateVendorDeliverySettlement({
      collectionTotal: 1000,
      productCost: 500,
      vendorShippingCost: 200,
    })).toEqual({ balance: 300, companyDue: 300, vendorDue: 0 });
  });

  it("makes the absolute value of a negative balance due to the vendor", () => {
    expect(calculateVendorDeliverySettlement({
      collectionTotal: 1000,
      productCost: 900,
      vendorShippingCost: 200,
    })).toEqual({ balance: -100, companyDue: 0, vendorDue: 100 });
  });

  it("never nets fines into the dues (fines are their own column)", () => {
    expect(calculateVendorDeliverySettlement({
      collectionTotal: 1000,
      fines: 30,
      productCost: 900,
      vendorShippingCost: 200,
    })).toEqual({ balance: -100, companyDue: 0, vendorDue: 100 });

    expect(calculateVendorDeliverySettlement({
      collectionTotal: 1000,
      fines: 150,
      productCost: 900,
      vendorShippingCost: 200,
    }).vendorDue).toBe(100);
    expect(calculateVendorDeliverySettlement({
      collectionTotal: 1000,
      fines: 150,
      productCost: 500,
      vendorShippingCost: 200,
    })).toEqual({ balance: 300, companyDue: 300, vendorDue: 0 });
  });

  it("a zero balance has neither due; a line never has both", () => {
    expect(calculateVendorDeliverySettlement({ collectionTotal: 700, productCost: 500, vendorShippingCost: 200 }))
      .toEqual({ balance: 0, companyDue: 0, vendorDue: 0 });
  });

  it("does not use any order shipping value", () => {
    expect(calculateVendorDeliverySettlement({
      collectionTotal: "1000.00",
      productCost: "500.00",
      vendorShippingCost: "0",
    })).toEqual({ balance: 500, companyDue: 500, vendorDue: 0 });
  });
});

describe("calculateWarehouseDeliverySettlement (Homix-delivered orders: vendor due = cost gross)", () => {
  it("vendor due = cost (before fines), company due = 0; margin is informational (client example 2,299 / 1,200 / 100)", () => {
    expect(calculateWarehouseDeliverySettlement({ collectionTotal: 2299, fines: 100, productCost: 1200 }))
      .toEqual({ companyDue: 0, margin: 1099, vendorDue: 1200 });
  });

  it("fines never change the vendor due", () => {
    expect(calculateWarehouseDeliverySettlement({ collectionTotal: 2299, fines: 5000, productCost: 1200 }).vendorDue).toBe(1200);
    expect(calculateWarehouseDeliverySettlement({ collectionTotal: 100, fines: -10, productCost: 60 }).vendorDue).toBe(60);
  });

  it("a missing/zero cost yields a zero vendor due (flagged in the UI), not the selling price", () => {
    expect(calculateWarehouseDeliverySettlement({ collectionTotal: 2299, fines: 100, productCost: 0 }))
      .toEqual({ companyDue: 0, margin: 2299, vendorDue: 0 });
    expect(calculateWarehouseDeliverySettlement({ collectionTotal: 2299, productCost: undefined }).vendorDue).toBe(0);
  });
});
