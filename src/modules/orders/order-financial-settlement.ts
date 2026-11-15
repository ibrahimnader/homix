const currency = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
};

/**
 * Seller-delivered orders are settled against Homix using the vendor's own
 * shipping cost, not the shipping fee stored on the order.
 */
export const calculateVendorDeliverySettlement = ({
  collectionTotal,
  fines,
  productCost,
  vendorShippingCost,
}: {
  collectionTotal: unknown;
  fines?: unknown;
  productCost: unknown;
  vendorShippingCost: unknown;
}): { balance: number; companyDue: number; vendorDue: number } => {
  const balance = currency(currency(collectionTotal) - currency(productCost) - currency(vendorShippingCost));
  const grossVendorDue = balance < 0 ? Math.abs(balance) : 0;

  return {
    balance,
    companyDue: balance > 0 ? balance : 0,
    vendorDue: currency(Math.max(grossVendorDue - Math.max(currency(fines), 0), 0)),
  };
};

/**
 * Orders Homix delivers (deliveryBy = HOMIX, delivered or not yet) are settled on the product COST price,
 * never on the selling price: vendorDue = max(0, cost - fines); companyDue = collection - cost
 * (Homix keeps the margin; no commission). Same rule as the warehouse settlement tab and the approved invoice sheet.
 */
export const calculateWarehouseDeliverySettlement = ({
  collectionTotal,
  fines,
  productCost,
}: {
  collectionTotal: unknown;
  fines?: unknown;
  productCost: unknown;
}): { companyDue: number; vendorDue: number } => {
  const cost = currency(productCost);
  return {
    companyDue: currency(currency(collectionTotal) - cost),
    vendorDue: currency(Math.max(cost - Math.max(currency(fines), 0), 0)),
  };
};
