/**
 * تعديل «سعر التكلفة» لطلب بعد إنشائه.
 *
 * Cost lives in two places: `Order.totalCost` (what the lists and the finance
 * report read) and `OrderLine.cost` / `OrderLine.unitCost` (what the per-line
 * profit figures read). Editing one without the other leaves the two
 * disagreeing, so every entry point goes through this module.
 *
 * A Shopify order is split into one Homix order per unit, so an order normally
 * holds a single line and the new total simply becomes that line's cost. When
 * there is more than one line the total is split across them in proportion to
 * their current costs — or evenly, when they are all zero.
 */

type OrderLineRecord = {
  cost?: unknown;
  id?: unknown;
  quantity?: unknown;
  update?: (payload: Record<string, unknown>) => Promise<unknown>;
};

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** يقبل قيمة رقمية موجبة أو صفراً فقط — أي شيء آخر يعني «لم يُرسل». */
export const parseCostPriceInput = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

/**
 * The new `cost` for each line so they sum to `totalCost`. The last line absorbs
 * the rounding remainder, so the parts always add back up to the total.
 */
export const distributeCostAcrossLines = (
  totalCost: number,
  lines: ReadonlyArray<OrderLineRecord>,
): number[] => {
  if (lines.length === 0) {
    return [];
  }

  if (lines.length === 1) {
    return [totalCost];
  }

  const currentCosts = lines.map((line) => Math.max(0, toNumber(line.cost)));
  const currentTotal = currentCosts.reduce((sum, cost) => sum + cost, 0);
  const weights = currentTotal > 0
    ? currentCosts.map((cost) => cost / currentTotal)
    : lines.map(() => 1 / lines.length);

  const shares = weights.map((weight) => Math.round(totalCost * weight * 100) / 100);
  const distributed = shares.slice(0, -1).reduce((sum, share) => sum + share, 0);
  shares[shares.length - 1] = Math.round((totalCost - distributed) * 100) / 100;

  return shares;
};

/**
 * Writes the new cost onto the order's lines. Returns the total actually
 * written, which is what `Order.totalCost` should be set to.
 */
export const applyCostPriceToLines = async (
  totalCost: number,
  lines: ReadonlyArray<OrderLineRecord>,
): Promise<number> => {
  const shares = distributeCostAcrossLines(totalCost, lines);

  for (const [index, line] of lines.entries()) {
    const share = shares[index] ?? 0;
    const quantity = Math.max(1, toNumber(line.quantity));
    if (typeof line.update === "function") {
      await line.update({
        cost: share,
        unitCost: Math.round((share / quantity) * 100) / 100,
      });
    }
  }

  return shares.reduce((sum, share) => sum + share, 0);
};
