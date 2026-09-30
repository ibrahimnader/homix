/**
 * تحديد «التوصيل بواسطة» تلقائياً عند إنشاء الطلب.
 *
 * The rule the business gave, in order of precedence:
 *   • أكثر من صنف واحد في الطلب الأصلي  → توصيل هوميكس
 *   • التوصيل خارج القاهرة والجيزة      → توصيل هوميكس
 *   • أصناف من أكثر من بائع             → توصيل هوميكس
 *   • غير ذلك (بائع واحد وداخل القاهرة/الجيزة) → توصيل بائع
 *
 * A Shopify order is split into one Homix order per unit, so the counts here
 * are the parent order's, not the split's — otherwise every split looks like a
 * single-item order and the first rule never fires.
 */

import {
  isInsideCairoGiza,
  isInsideCairoGizaValue,
  resolveGovernorateValue,
} from "../../shared/governorate/governorate.resolver";

const { DELIVERY_BY } = require("../../../config/constants") as {
  DELIVERY_BY: { HOMIX: number; VENDOR: number };
};

type AddressLike = {
  address?: unknown;
  address1?: unknown;
  address2?: unknown;
  city?: unknown;
  governorate?: unknown;
  province?: unknown;
};

type CustomerLike = AddressLike & {
  default_address?: AddressLike;
};

/**
 * Flattens every address-ish field a customer payload might carry into one
 * string. Shopify sends `default_address`, manual orders send the fields flat,
 * and already-persisted customers send a single pre-joined `address`.
 */
export const buildAddressText = (customer: CustomerLike | null | undefined): string => {
  if (!customer) {
    return "";
  }

  const sources: AddressLike[] = [customer];
  if (customer.default_address) {
    sources.push(customer.default_address);
  }

  const parts: string[] = [];
  sources.forEach((source) => {
    [source.address, source.address1, source.address2, source.city, source.province, source.governorate]
      .forEach((value) => {
        if (value !== null && value !== undefined && String(value).trim() !== "") {
          parts.push(String(value).trim());
        }
      });
  });

  return parts.join(" - ");
};

/**
 * The governorate to store on the order: whatever was explicitly supplied wins,
 * otherwise it is read out of the customer's address. Returns `null` when the
 * address names no governorate we know — better an empty column than a wrong one.
 */
export const resolveOrderGovernorate = (
  explicitGovernorate: unknown,
  customer: CustomerLike | null | undefined,
): string | null => {
  if (explicitGovernorate !== null && explicitGovernorate !== undefined && String(explicitGovernorate).trim() !== "") {
    return String(explicitGovernorate);
  }

  return resolveGovernorateValue(buildAddressText(customer));
};

export type DeliveryRoutingInput = {
  /** قيمة `governorate` المخزّنة (معرّف أو اسم) إن وُجدت. */
  governorate?: unknown;
  /** العنوان الكامل — يُستخدم حين لا تكون المحافظة محسومة. */
  addressText?: unknown;
  /** عدد الأصناف في الطلب الأصلي قبل التقسيم. */
  unitCount: number;
  /** معرّفات بائعي كل أصناف الطلب الأصلي. */
  vendorIds: ReadonlyArray<unknown>;
};

/** `DELIVERY_BY.HOMIX` أو `DELIVERY_BY.VENDOR`. */
export const resolveDeliveryBy = ({
  addressText,
  governorate,
  unitCount,
  vendorIds,
}: DeliveryRoutingInput): number => {
  if (Number(unitCount) > 1) {
    return DELIVERY_BY.HOMIX;
  }

  const distinctVendors = new Set(
    vendorIds
      .filter((vendorId) => vendorId !== null && vendorId !== undefined && vendorId !== "")
      .map((vendorId) => String(vendorId)),
  );
  if (distinctVendors.size > 1) {
    return DELIVERY_BY.HOMIX;
  }

  const insideCairoGiza = governorate !== null && governorate !== undefined && String(governorate).trim() !== ""
    ? isInsideCairoGizaValue(governorate)
    : isInsideCairoGiza(addressText);

  return insideCairoGiza ? DELIVERY_BY.VENDOR : DELIVERY_BY.HOMIX;
};
