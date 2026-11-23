import { Op } from "sequelize";

import { env } from "../../../src/config/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../src/shared/errors";
import {
  cloneVariantWithoutIds,
  costChanged,
  duplicateSkuBase,
  generateUniqueSku,
  newLocalVariantId,
  parseLocalProductKey,
  randomSkuBase,
  toLocalProductKey,
  type StoredVariant,
} from "./product.system";
import type { CreateSystemProductInput, DuplicateProductInput } from "./product.schemas";

const { sequelize } = require("../../../src/infrastructure/database") as typeof import("../../../src/infrastructure/database");
const VendorsService = require("../vendor/vendor.service") as typeof import("../vendor/vendor.service");
const Product = require("./product.model") as typeof import("./product.model");
const ShopifyHelper = require("../helpers/shopifyHelper");
const Vendor = require("../vendor/vendor.model") as typeof import("../vendor/vendor.model");
const ProductCategory = require("../category/productCategory.model") as typeof import("../category/productCategory.model");
const Category = require("../category/category.model") as typeof import("../category/category.model");
const ProductType = require("./productType.model") as typeof import("./productType.model");

type ProductTypeRecord = {
  id: number;
  name: string;
};

type VendorRecord = {
  id: number;
  name?: string;
};

type CategoryRecord = {
  id: number;
  title: string;
};

type ProductRecord = {
  id: number;
  productId?: number;
  shopifyId: string;
  toJSON?: () => ProductRecord;
  update: (payload: Record<string, unknown>) => Promise<ProductRecord>;
  vendor?: VendorRecord;
  vendorId: number;
  variants: unknown[];
};

type ProductVariantInput = {
  id: number | string;
  inventory_item_id?: number | string;
  option1?: string;
  option2?: string;
  option3?: string;
  price?: string | number;
  sku?: string;
  title?: string;
};

type ShopifyProductInput = {
  id: number | string;
  image?: { src?: string } | null;
  product_type?: string;
  title: string;
  variants: ProductVariantInput[];
  vendor: string;
};

type ProductsResponse = {
  data: unknown;
  message?: string;
  status: boolean;
  statusCode: number;
  vendorsMap?: Record<string, VendorRecord>;
};

type ImportProductsResponse = ProductsResponse & {
  data: ProductRecord[];
  vendorsMap: Record<string, VendorRecord>;
};

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 50;
const DEFAULT_PRODUCT_IMAGE = `${env.APP_URL}/uploads/default-product.png`;

const toNumberArray = (values: string[]): number[] => {
  return values.map((value) => Number(value)).filter(Boolean);
};

const buildProductSearch = (searchQuery: string): Record<symbol, unknown> | undefined => {
  const terms = searchQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10);

  if (terms.length === 0) return undefined;

  return {
    [Op.and]: terms.map((term) => ({
      [Op.or]: [
        sequelize.where(sequelize.fn("lower", sequelize.col("Product.title")), {
          [Op.like]: `%${term}%`,
        }),
        sequelize.where(sequelize.fn("lower", sequelize.col("vendor.name")), {
          [Op.like]: `%${term}%`,
        }),
        sequelize.where(sequelize.fn("lower", sequelize.col("Product.shopifyId")), {
          [Op.like]: `%${term}%`,
        }),
        // SKU and variant Shopify codes are stored inside the variants JSON.
        sequelize.where(
          sequelize.fn("lower", sequelize.cast(sequelize.col("Product.variants"), "text")),
          { [Op.like]: `%${term}%` },
        ),
      ],
    })),
  };
};

class ProductsService {
  public static async getExistingTypesMap(typesNames: string[]): Promise<Record<string, number>> {
    const typesMap: Record<string, number> = {};
    const existingTypes = (await ProductType.findAll({
      where: {
        name: {
          [Op.in]: typesNames,
        },
      },
    })) as ProductTypeRecord[];

    existingTypes.forEach((type) => {
      typesMap[type.name] = type.id;
    });

    const newTypes = [...new Set(typesNames.filter((type) => !typesMap[type]))];
    const createdTypes = (await ProductType.bulkCreate(newTypes.map((name) => ({ name })))) as ProductTypeRecord[];
    createdTypes.forEach((type) => {
      typesMap[type.name] = type.id;
    });

    return typesMap;
  }

  public static async getProductsTypes(): Promise<ProductsResponse> {
    const types = await ProductType.findAll({
      attributes: ["name", "id"],
    });

    return {
      data: types,
      status: true,
      statusCode: 200,
    };
  }

  public static async getProducts(
    page: string | number = DEFAULT_PAGE,
    size: string | number = DEFAULT_SIZE,
    searchQuery = "",
    vendorsId: string[] = [],
    categories: string[] = [],
    typesIds: string[] = [],
  ): Promise<ProductsResponse> {
    const whereClause: Record<string, unknown> = {};

    // Products copied internally while assigning an order to another vendor
    // deliberately have no Shopify id. They belong to that order relationship,
    // not to the product catalogue, and must not appear as duplicate products
    // (most visibly as many "Custom Product" cards).
    whereClause.isCatalogProduct = true;

    if (categories.length) {
      const validCategories = toNumberArray(categories);
      const productIds = (await ProductCategory.findAll({
        attributes: ["productId"],
        group: ["productId"],
        where: {
          categoryId: {
            [Op.in]: validCategories,
          },
        },
      })) as Array<{ productId: number }>;

      whereClause.id = {
        [Op.in]: productIds.map((product) => product.productId),
      };
    }

    if (typesIds.length) {
      whereClause.typeId = {
        [Op.in]: toNumberArray(typesIds),
      };
    }

    const products = await Product.findAndCountAll({
      distinct: true,
      include: [
        {
          as: "vendor",
          attributes: ["name"],
          model: Vendor,
          required: true,
          where:
            vendorsId.length > 0
              ? { id: { [Op.in]: vendorsId.map((id) => Number(id)) } }
              : {},
        },
        {
          as: "categories",
          attributes: ["categoryId"],
          include: [
            {
              as: "category",
              attributes: ["title"],
              model: Category,
            },
          ],
          model: ProductCategory,
          required: false,
        },
        {
          as: "type",
          model: ProductType,
          required: false,
        },
      ],
      limit: Number(size),
      offset: (Number(page) - 1) * Number(size),
      where: {
        ...whereClause,
        ...(buildProductSearch(searchQuery) ?? {}),
      },
    });

    return {
      data: {
        products: products.rows,
        totalPages: Math.ceil(products.count / Number(size)),
      },
      status: true,
      statusCode: 200,
    };
  }

  public static async getOneProduct(id: string): Promise<ProductsResponse> {
    const product = await Product.findByPk(id, {
      include: [
        {
          as: "vendor",
          attributes: ["name"],
          model: Vendor,
        },
        {
          as: "categories",
          include: [
            {
              as: "category",
              attributes: ["title"],
              model: Category,
            },
          ],
          model: ProductCategory,
        },
      ],
    });

    return {
      data: product,
      status: true,
      statusCode: 200,
    };
  }

  public static async getProductsMappedByShopifyIds(productsIds: string[]) {
    const allVendorsMap: Record<string, VendorRecord> = {};

    // System-created products have no Shopify id; orders reference them as `local:<id>`.
    const localIds = productsIds.map((key) => parseLocalProductKey(key)).filter((id): id is number => id !== null);
    productsIds = productsIds.filter((key) => parseLocalProductKey(key) === null);
    const localProducts = localIds.length
      ? ((await Product.findAll({
          attributes: ["shopifyId", "id", "variants", "vendorId"],
          include: [{ as: "vendor", model: Vendor }],
          where: { id: { [Op.in]: localIds }, isSystemCreated: true },
        })) as ProductRecord[])
      : [];
    const foundLocalIds = new Set(localProducts.map((product) => Number(product.id)));
    const missingLocalId = localIds.find((id) => !foundLocalIds.has(id));
    if (missingLocalId !== undefined) {
      throw new NotFoundError(`Product ${toLocalProductKey(missingLocalId)} not found`);
    }

    const products = (await Product.findAll({
      attributes: ["shopifyId", "id", "variants", "vendorId"],
      include: [
        {
          as: "vendor",
          model: Vendor,
        },
      ],
      where: {
        shopifyId: [...productsIds, "custom"],
      },
    })) as ProductRecord[];

    const productsMap: Record<string, ProductRecord> = {};
    const existingShopifyIds = new Set<string>();

    for (const product of localProducts) {
      productsMap[toLocalProductKey((product as { id: number }).id)] = product;
      allVendorsMap[String(product.vendorId)] = product.vendor as VendorRecord;
    }

    for (const product of products) {
      productsMap[product.shopifyId] = product;
      existingShopifyIds.add(String(product.shopifyId));
      allVendorsMap[String(product.vendorId)] = product.vendor as VendorRecord;
    }

    const nonExistingProductsIds = productsIds.filter(
      (id) => !existingShopifyIds.has(String(id)),
    );

    if (nonExistingProductsIds.length > 0) {
      const result = (await ProductsService.importProducts({
        ids: nonExistingProductsIds.join(","),
      })) as ImportProductsResponse;
      for (const product of result.data as ProductRecord[]) {
        productsMap[product.shopifyId] = product;
      }
      for (const [vendorId, vendor] of Object.entries(result.vendorsMap)) {
        allVendorsMap[vendorId] = vendor;
      }
    }

    return {
      productsMap,
      vendorsMap: allVendorsMap,
    };
  }

  public static async importProducts(
    parameters: Record<string, unknown>,
    fromImport = false,
  ): Promise<ProductsResponse | void> {
    const fields = ["id", "title", "vendor", "variants", "image", "collection_id", "product_type"];
    const args: unknown[] = ["products", fields, parameters];

    if (fromImport) {
      args.push(async (products: ShopifyProductInput[]) => {
        await ProductsService.saveImportedProducts(products);
      });
      await ShopifyHelper.importData(...args);
      return;
    }

    const products = (await ShopifyHelper.importData(...args)) as ShopifyProductInput[];
    return ProductsService.saveImportedProducts(products);
  }

  public static async getInventoryMap(itemsIds: Array<number | string>): Promise<Record<string, unknown>> {
    const inventoryMap: Record<string, unknown> = {};
    const itemsIdsChunks = ShopifyHelper.splitArrayToChunks(itemsIds, 250);

    for (const itemsIdsChunk of itemsIdsChunks) {
      const inventory = await ShopifyHelper.importData("inventory_items", ["id", "cost"], {
        ids: itemsIdsChunk.join(","),
      });
      for (const item of inventory as Array<{ id: number | string; cost: unknown }>) {
        inventoryMap[String(item.id)] = item.cost;
      }
    }

    return inventoryMap;
  }

  public static async saveImportedProducts(products: ShopifyProductInput[]): Promise<ProductsResponse> {
    const vendorsNames = products.map((product) => product.vendor);
    const typesNames = products.map((product) => product.product_type).filter(Boolean) as string[];
    const vendorsMap = await VendorsService.getExistingVendorsMap(vendorsNames);
    const typesMap = await ProductsService.getExistingTypesMap(typesNames);
    const result = await ProductsService.saveProductToDB(products, vendorsMap, typesMap);

    return {
      data: result,
      message: "Products imported successfully",
      status: true,
      statusCode: 200,
      vendorsMap,
    };
  }

  public static async createProduct(productData: ShopifyProductInput): Promise<ProductsResponse> {
    const vendor = await VendorsService.getVendorByNameAndSaveIfNotExist(productData.vendor);
    const result = await ProductsService.saveProductToDB(
      [productData],
      { [productData.vendor]: vendor },
      {},
    );

    return {
      data: result[0],
      message: "Product created successfully",
      status: true,
      statusCode: 200,
    };
  }

  public static async saveProductToDB(
    productsData: ShopifyProductInput[],
    vendorsMap: Record<string, VendorRecord>,
    typesMap: Record<string, number>,
  ) {
    const itemsIds = productsData
      .map((product) =>
        product.variants
          .filter((variant) => variant.inventory_item_id)
          .map((variant) => variant.inventory_item_id as number | string),
      )
      .flat();

    let inventoryMap: Record<string, unknown> = {};
    if (itemsIds.length > 0) {
      inventoryMap = await ProductsService.getInventoryMap(itemsIds);
    }

    const normalizedProducts = productsData.map((product) => ({
      image: product.image?.src ?? DEFAULT_PRODUCT_IMAGE,
      shopifyId: String(product.id),
      title: product.title,
      typeId: product.product_type ? typesMap[product.product_type] || null : null,
      variants: product.variants.map((variant) => ({
        color: variant.option1,
        cost:
          variant.inventory_item_id && inventoryMap[String(variant.inventory_item_id)]
            ? Number(inventoryMap[String(variant.inventory_item_id)])
            : 0,
        material: variant.option3,
        price: variant.price,
        shopifyId: String(variant.id),
        size: variant.option2,
        sku: variant.sku,
        title: variant.title,
      })),
      vendorId: vendorsMap[product.vendor]?.id ?? 0,
    }));

    const savedProducts = await Promise.all(
      normalizedProducts.map(async (product) => {
        try {
          const existingProduct = (await Product.findOne({
            where: { shopifyId: product.shopifyId },
          })) as ProductRecord | null;


          // System-created products are owned by this app: a Shopify payload must never overwrite them.
          if (existingProduct && (existingProduct as { isSystemCreated?: boolean }).isSystemCreated) {
            return existingProduct;
          }

          if (existingProduct) {
            await existingProduct.update({
              image: product.image,
              title: product.title,
              typeId: product.typeId,
              variants: product.variants,
              vendorId: product.vendorId,
            });
            return existingProduct;
          }

          return Product.create({
            image: product.image,
            shopifyId: product.shopifyId,
            title: product.title,
            typeId: product.typeId,
            variants: product.variants,
            vendorId: product.vendorId,
          });
        } catch (_error) {
          return null;
        }
      }),
    );

    return savedProducts.filter(Boolean);
  }

  /** True when any live product already uses `sku` in one of its variants (case-insensitive exact match). */
  public static async skuExists(sku: string): Promise<boolean> {
    const rows = (await sequelize.query(
      `SELECT 1 FROM products
        WHERE "deletedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM json_array_elements(CASE WHEN json_typeof("variants") = 'array' THEN "variants" ELSE '[]'::json END) AS variant
             WHERE lower(variant->>'sku') = lower(:sku)
          )
        LIMIT 1`,
      { replacements: { sku }, type: "SELECT" },
    )) as unknown[];
    return rows.length > 0;
  }

  /**
   * Resolves the final sku of each variant: an explicit sku must be free (409 otherwise),
   * an empty one is generated from `fallbackBase` (`<base>-C1`...).
   */
  private static async resolveVariantSkus<T extends { sku: string | null }>(
    variants: T[],
    fallbackBase: (index: number) => string,
  ): Promise<Array<T & { sku: string }>> {
    const reserved = new Set<string>();
    const resolved: Array<T & { sku: string }> = [];
    const isTaken = (candidate: string) => ProductsService.skuExists(candidate);

    for (const [index, variant] of variants.entries()) {
      let sku: string;
      if (variant.sku) {
        if (await isTaken(variant.sku)) {
          throw new ConflictError(`كود المنتج ${variant.sku} مستخدم بالفعل`);
        }
        sku = variant.sku;
      } else {
        sku = await generateUniqueSku(fallbackBase(index), isTaken, reserved, { tryBaseFirst: false });
      }
      reserved.add(sku.toLowerCase());
      resolved.push({ ...variant, sku });
    }
    return resolved;
  }

  private static async assertVendorExists(vendorId: number): Promise<void> {
    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) throw new ValidationError("البائع غير موجود");
  }

  private static async assertTypeExists(typeId: number | null | undefined): Promise<void> {
    if (!typeId) return;
    const type = await ProductType.findByPk(typeId);
    if (!type) throw new ValidationError("نوع المنتج غير موجود");
  }

  /** Brand-new product created inside the system (no Shopify id). */
  public static async createSystemProduct(
    input: CreateSystemProductInput,
    options: { canEditFinancials: boolean },
  ): Promise<ProductsResponse> {
    if (!options.canEditFinancials && input.variants.some((variant) => costChanged(variant.cost, 0))) {
      throw new ForbiddenError("ليس لديك صلاحية تعديل التفاصيل المالية (سعر التكلفة)");
    }
    await ProductsService.assertVendorExists(input.vendorId);
    await ProductsService.assertTypeExists(input.typeId);

    const base = randomSkuBase();
    const variants = await ProductsService.resolveVariantSkus(input.variants, (index) =>
      input.variants.length > 1 ? `${base}-V${index + 1}` : base,
    );

    const product = await Product.create({
      image: input.image ?? DEFAULT_PRODUCT_IMAGE,
      isCatalogProduct: true,
      isSystemCreated: true,
      shopifyId: null,
      title: input.title,
      typeId: input.typeId ?? null,
      variants: variants.map((variant) => ({
        color: variant.color,
        cost: variant.cost ?? 0,
        id: newLocalVariantId(),
        material: variant.material,
        price: variant.price,
        size: variant.size,
        sku: variant.sku,
        title: variant.title ?? "Default Title",
      })),
      vendorId: input.vendorId,
    });

    return { data: product, message: "Product created successfully", status: true, statusCode: 201 };
  }

  /**
   * Duplicates a catalogue product into a new system product. Copies title, vendor, type,
   * image, variants (price/cost/attributes) and category links; never the Shopify ids.
   * `overrides` (the edited form) win over the copied values; codes are regenerated unique.
   */
  public static async duplicateProduct(
    sourceId: number,
    overrides: DuplicateProductInput,
    options: { canEditFinancials: boolean },
  ): Promise<ProductsResponse> {
    const source = (await Product.findByPk(sourceId, {
      include: [{ as: "categories", model: ProductCategory }],
    })) as unknown as
      | (ProductRecord & {
          categories?: Array<{ categoryId: number | null }>;
          image?: string | null;
          isCatalogProduct?: boolean;
          status?: number | null;
          title: string;
          typeId?: number | null;
        })
      | null;
    if (!source || source.isCatalogProduct === false) throw new NotFoundError("المنتج غير موجود");

    const sourceVariants = (Array.isArray(source.variants) ? source.variants : []) as StoredVariant[];
    const vendorId = overrides.vendorId ?? source.vendorId;
    const typeId = overrides.typeId !== undefined ? overrides.typeId : source.typeId ?? null;

    if (!options.canEditFinancials && overrides.variants) {
      const changed = overrides.variants.some((variant, index) => costChanged(variant.cost, sourceVariants[index]?.cost));
      if (changed) throw new ForbiddenError("ليس لديك صلاحية تعديل التفاصيل المالية (سعر التكلفة)");
    }
    if (overrides.vendorId !== undefined) await ProductsService.assertVendorExists(vendorId);
    if (overrides.typeId !== undefined) await ProductsService.assertTypeExists(typeId);

    const fallbackBase = randomSkuBase();
    let variants: StoredVariant[];
    if (overrides.variants) {
      const resolved = await ProductsService.resolveVariantSkus(overrides.variants, (index) =>
        duplicateSkuBase(sourceVariants[index]?.sku ?? sourceVariants[0]?.sku, fallbackBase),
      );
      variants = resolved.map((variant, index) => ({
        ...cloneVariantWithoutIds(sourceVariants[index] ?? {}, variant.sku),
        color: variant.color,
        cost: options.canEditFinancials ? (variant.cost ?? (Number(sourceVariants[index]?.cost) || 0)) : (Number(sourceVariants[index]?.cost) || 0),
        material: variant.material,
        price: variant.price,
        size: variant.size,
        title: variant.title,
      }));
    } else {
      const reserved = new Set<string>();
      variants = [];
      for (const variant of sourceVariants) {
        const sku = await generateUniqueSku(
          duplicateSkuBase(variant.sku, fallbackBase),
          (candidate) => ProductsService.skuExists(candidate),
          reserved,
        );
        reserved.add(sku.toLowerCase());
        variants.push(cloneVariantWithoutIds(variant, sku));
      }
    }

    const created = await sequelize.transaction(async (transaction: unknown) => {
      const product = (await Product.create(
        {
          image: overrides.image !== undefined ? overrides.image ?? DEFAULT_PRODUCT_IMAGE : source.image ?? DEFAULT_PRODUCT_IMAGE,
          isCatalogProduct: true,
          isSystemCreated: true,
          shopifyId: null,
          status: source.status ?? 0,
          title: overrides.title ?? source.title,
          typeId,
          variants,
          vendorId,
        },
        { transaction },
      )) as unknown as { id: number };
      const categoryLinks = (source.categories ?? [])
        .filter((link) => link.categoryId)
        .map((link) => ({ categoryId: link.categoryId, productId: product.id, shopifyId: null }));
      if (categoryLinks.length) await ProductCategory.bulkCreate(categoryLinks, { transaction });
      return product;
    });

    return { data: created, message: "Product duplicated successfully", status: true, statusCode: 201 };
  }

  public static async getAllCategories(): Promise<ProductsResponse> {
    const categories = await Category.findAll({
      attributes: ["title", "id"],
    });

    return {
      data: categories,
      status: true,
      statusCode: 200,
    };
  }
}

export = ProductsService;
