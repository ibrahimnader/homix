const currency = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
};

/**
 * Seller-delivered orders are settled against Homix using the vendor's own
 * shipping cost, not the shipping fee stored on the order.
 *
 * Reference model (owner decision, Nov 2026): balance = collection − cost − vendor shipping.
 * balance >= 0 → «مستحق هوميكس» = balance (the vendor owes Homix); balance < 0 → «مستحق البائع» = −balance.
 * Fines are NOT netted here: they are their own column and are subtracted once from the invoice net.
 * A line never has both dues.
 */
export const calculateVendorDeliverySettlement = ({
  collectionTotal,
  productCost,
  vendorShippingCost,
}: {
  collectionTotal: unknown;
  /** accepted for call-site compatibility; ignored (fines never alter the dues) */
  fines?: unknown;
  productCost: unknown;
  vendorShippingCost: unknown;
}): { balance: number; companyDue: number; vendorDue: number } => {
  const balance = currency(currency(collectionTotal) - currency(productCost) - currency(vendorShippingCost));

  return {
    balance,
    companyDue: balance > 0 ? balance : 0,
    vendorDue: balance < 0 ? Math.abs(balance) : 0,
  };
};

/**
 * Orders Homix delivers (deliveryBy = HOMIX, delivered or not yet) are settled on the product COST price:
 * «مستحق البائع» = cost (GROSS, before fines), «مستحق هوميكس» = 0. `margin` (collection − cost) is Homix's own
 * share; it is informational only and is never shown nor summed into any due.
 */
export const calculateWarehouseDeliverySettlement = ({
  collectionTotal,
  productCost,
}: {
  collectionTotal: unknown;
  /** accepted for call-site compatibility; ignored (fines never alter the dues) */
  fines?: unknown;
  productCost: unknown;
}): { companyDue: number; margin: number; vendorDue: number } => {
  const cost = currency(productCost);
  return {
    companyDue: 0,
    margin: currency(currency(collectionTotal) - cost),
    vendorDue: cost,
  };
};
