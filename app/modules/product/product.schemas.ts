import { z } from "zod";

const money = z.coerce.number().finite().min(0).max(100_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);

export const productVariantInputSchema = z.object({
  color: optionalText(100),
  cost: money.optional(),
  material: optionalText(100),
  price: money,
  size: optionalText(100),
  /** Optional: generated automatically (unique) when empty. */
  sku: z.string().trim().max(64).nullish().transform((value) => value || null),
  title: optionalText(255),
}).strict();

const imageSchema = z.string().trim().max(2048).nullish().transform((value) => value || null);
const variantsSchema = z.array(productVariantInputSchema).min(1).max(50);

const hasUniqueSkus = (variants: Array<{ sku: string | null }> | undefined): boolean => {
  const skus = (variants ?? []).map((variant) => variant.sku?.toLowerCase()).filter(Boolean);
  return new Set(skus).size === skus.length;
};
const DUPLICATE_SKU_MESSAGE = "Variant codes must be unique within a product";

/** POST /products/system — brand-new product. */
export const createSystemProductSchema = z.object({
  image: imageSchema,
  title: z.string().trim().min(1).max(255),
  typeId: z.coerce.number().int().positive().nullish().transform((value) => value ?? null),
  variants: variantsSchema,
  vendorId: z.coerce.number().int().positive(),
}).strict().refine((body) => hasUniqueSkus(body.variants), { message: DUPLICATE_SKU_MESSAGE, path: ["variants"] });

/** POST /products/:id/duplicate — every field optional, merged over the source product. */
export const duplicateProductSchema = z.object({
  image: imageSchema.optional(),
  title: z.string().trim().min(1).max(255).optional(),
  typeId: z.coerce.number().int().positive().nullish().transform((value) => value ?? null).optional(),
  variants: variantsSchema.optional(),
  vendorId: z.coerce.number().int().positive().optional(),
}).strict().refine((body) => hasUniqueSkus(body.variants), { message: DUPLICATE_SKU_MESSAGE, path: ["variants"] });

export const productIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type CreateSystemProductInput = z.infer<typeof createSystemProductSchema>;
export type DuplicateProductInput = z.infer<typeof duplicateProductSchema>;
