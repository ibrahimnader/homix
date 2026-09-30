import {
  applyCostPriceToLines,
  distributeCostAcrossLines,
  parseCostPriceInput,
} from "./order-cost-price";

describe("parseCostPriceInput", () => {
  it("accepts zero and positive numbers, including numeric strings", () => {
    expect(parseCostPriceInput(0)).toBe(0);
    expect(parseCostPriceInput("125.5")).toBe(125.5);
  });

  it("rejects anything that is not a usable cost", () => {
    expect(parseCostPriceInput(null)).toBeNull();
    expect(parseCostPriceInput("")).toBeNull();
    expect(parseCostPriceInput("abc")).toBeNull();
    expect(parseCostPriceInput(-5)).toBeNull();
  });
});

describe("distributeCostAcrossLines", () => {
  it("gives the whole cost to a single line", () => {
    expect(distributeCostAcrossLines(300, [{ cost: 120 }])).toEqual([300]);
  });

  it("splits proportionally to the current costs", () => {
    expect(distributeCostAcrossLines(300, [{ cost: 100 }, { cost: 200 }])).toEqual([100, 200]);
  });

  it("splits evenly when every line currently costs zero", () => {
    expect(distributeCostAcrossLines(300, [{ cost: 0 }, { cost: 0 }])).toEqual([150, 150]);
  });

  it("always sums back to the requested total", () => {
    const shares = distributeCostAcrossLines(100, [{ cost: 1 }, { cost: 1 }, { cost: 1 }]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(100, 2);
  });

  it("returns nothing for an order with no lines", () => {
    expect(distributeCostAcrossLines(300, [])).toEqual([]);
  });
});

describe("applyCostPriceToLines", () => {
  it("writes cost and per-unit cost onto each line and reports the total", async () => {
    const update = jest.fn(async () => undefined);
    const lines = [{ cost: 0, quantity: 2, update }];

    const total = await applyCostPriceToLines(250, lines);

    expect(update).toHaveBeenCalledWith({ cost: 250, unitCost: 125 });
    expect(total).toBe(250);
  });

  it("treats a missing quantity as one unit", async () => {
    const update = jest.fn(async () => undefined);
    await applyCostPriceToLines(80, [{ cost: 0, update }]);
    expect(update).toHaveBeenCalledWith({ cost: 80, unitCost: 80 });
  });
});
