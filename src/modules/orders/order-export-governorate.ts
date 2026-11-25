import { governorateDisplayLabel, matchGovernorate } from "../../shared/governorate/governorate.resolver";

/**
 * «المحافظة» in the orders export: the stored value (id or legacy text) as its Arabic name; when the order has none
 * the customer's address is read for DISPLAY only (nothing is written back), so old orders still show a governorate.
 */
export const resolveExportGovernorateLabel = (stored: unknown, address: unknown): string => {
  const direct = governorateDisplayLabel(stored);
  if (direct) {
    return direct;
  }

  return matchGovernorate(address)?.label ?? "";
};
