/**
 * Pure helpers for products created inside the system (not imported from Shopify).
 *
 * A system product has `shopifyId = null` and `isSystemCreated = true`. Orders reference it
 * by the synthetic key `local:<productId>` (the order flow keys products by Shopify id), and
 * its variants carry a local `id` instead of a `shopifyId`.
 */
import { randomUUID } from "crypto";

export const LOCAL_PRODUCT_PREFIX = "local:";
export const LOCAL_VARIANT_PREFIX = "local-";
const SKU_SUFFIX_PATTERN = /-C\d+$/i;
const MAX_SKU_ATTEMPTS = 1000;

export type StoredVariant = {
  color?: string | null;
  cost?: number | string | null;
  id?: string;
  material?: string | null;
  price?: number | string | null;
  shopifyId?: string | null;
  size?: string | null;
  sku?: string | null;
  title?: string | null;
};

export type VariantInput = {
  color?: string | null;
  cost?: number | null;
  material?: string | null;
  price?: number;
  size?: string | null;
  sku?: string | null;
  title?: string | null;
};

export type SkuTakenCheck = (sku: string) => Promise<boolean>;

export const toLocalProductKey = (productId: number | string): string => `${LOCAL_PRODUCT_PREFIX}${productId}`;

/** `local:12` -> 12; anything else (Shopify ids, "custom") -> null. */
export const parseLocalProductKey = (value: unknown): number | null => {
  const text = String(value ?? "");
  if (!text.startsWith(LOCAL_PRODUCT_PREFIX)) return null;
  const id = Number(text.slice(LOCAL_PRODUCT_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const newLocalVariantId = (): string => `${LOCAL_VARIANT_PREFIX}${randomUUID().slice(0, 8)}`;

/** Base used to derive a duplicate's code: the source code without a previous `-C<n>` suffix. */
export const duplicateSkuBase = (sourceSku: string | null | undefined, fallback: string): string => {
  const cleaned = String(sourceSku ?? "").trim().replace(SKU_SUFFIX_PATTERN, "");
  return cleaned || fallback;
};

/**
 * Returns a code that is not taken (per `isTaken`) nor in `reserved` (codes already given to
 * sibling variants of the same product). `preferred` is tried first as-is, then `<base>-C1`,
 * `-C2`... so duplicates of `RKA-001` become `RKA-001-C1`.
 */
export const generateUniqueSku = async (
  base: string,
  isTaken: SkuTakenCheck,
  reserved: ReadonlySet<string> = new Set(),
  options: { tryBaseFirst?: boolean } = {},
): Promise<string> => {
  const candidates = function* candidateGenerator(): Generator<string> {
    if (options.tryBaseFirst) yield base;
    for (let index = 1; index <= MAX_SKU_ATTEMPTS; index += 1) yield `${base}-C${index}`;
  };

  for (const candidate of candidates()) {
    if (reserved.has(candidate.toLowerCase())) continue;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error("Could not generate a unique product code");
};

/** Random base for brand-new products without any code (`SYS-7K3QX9`). */
export const randomSkuBase = (random: () => number = Math.random): string =>
  `SYS-${Math.floor(random() * 36 ** 6).toString(36).toUpperCase().padStart(6, "0")}`;

const toCleanText = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

/** A variant copied from `source`: same attributes, fresh local id, no Shopify ids, new sku. */
export const cloneVariantWithoutIds = (source: StoredVariant, sku: string): StoredVariant => ({
  color: toCleanText(source.color),
  cost: Number(source.cost) || 0,
  id: newLocalVariantId(),
  material: toCleanText(source.material),
  price: Number(source.price) || 0,
  size: toCleanText(source.size),
  sku,
  title: toCleanText(source.title),
});

/** Cost changes need the financial permission; an unchanged cost (e.g. copied) never does. */
export const costChanged = (next: number | null | undefined, previous: number | string | null | undefined): boolean => {
  if (next === undefined || next === null) return false;
  return Math.abs(Number(next) - (Number(previous) || 0)) >= 0.005;
};
