import path from "path";

import { loadModuleWithMocks } from "../test-utils/load-module-with-mocks";

const ROOT = process.cwd();
const PRODUCT_SERVICE_PATH = path.join(ROOT, "app/modules/product/product.service.ts");

type FakeProduct = Record<string, any>;

/** In-memory stand-ins for the Sequelize models, enough to exercise create/duplicate/sync. */
const buildService = (seed: FakeProduct[] = []) => {
  const products: FakeProduct[] = seed.map((product) => ({ ...product }));
  let nextId = 100;
  const links: FakeProduct[] = [];

  const ProductModel = {
    create: jest.fn(async (values: FakeProduct) => {
      const row: FakeProduct = { id: nextId++, ...values, update: jest.fn(async (patch: FakeProduct) => Object.assign(row, patch)) };
      products.push(row);
      return row;
    }),
    findByPk: jest.fn(async (id: number) => products.find((product) => product.id === id) ?? null),
    findOne: jest.fn(async ({ where }: { where: FakeProduct }) =>
      products.find((product) => product.shopifyId === where.shopifyId) ?? null),
  };
  const ProductCategoryModel = {
    bulkCreate: jest.fn(async (rows: FakeProduct[]) => { links.push(...rows); return rows; }),
    findAll: jest.fn().mockResolvedValue([]),
  };
  const vendors = [{ id: 4, name: "ركنة" }, { id: 9, name: "آخر" }];
  const types = [{ id: 3, name: "دريسنج" }];
  const sequelize = {
    col: jest.fn(), fn: jest.fn(), where: jest.fn(),
    query: jest.fn(async (_sql: string, options: { replacements: { sku: string } }) =>
      products.some((product) => (product.variants ?? []).some((variant: FakeProduct) =>
        String(variant.sku ?? "").toLowerCase() === options.replacements.sku.toLowerCase())) ? [{ "?column?": 1 }] : []),
    transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({})),
  };

  const service = loadModuleWithMocks<typeof import("../../app/modules/product/product.service")>(PRODUCT_SERVICE_PATH, {
    "../../../src/infrastructure/database": { sequelize },
    "../../../config/shopify": {},
    "../category/category.model": {},
    "../category/productCategory.model": ProductCategoryModel,
    "../helpers/shopifyHelper": { importData: jest.fn(), splitArrayToChunks: jest.fn() },
    "../vendor/vendor.model": { findByPk: jest.fn(async (id: number) => vendors.find((vendor) => vendor.id === id) ?? null) },
    "../vendor/vendor.service": { getExistingVendorsMap: jest.fn().mockResolvedValue({ "ركنة": { id: 4 } }) },
    "./product.model": ProductModel,
    "./productType.model": {
      bulkCreate: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue([]),
      findByPk: jest.fn(async (id: number) => types.find((type) => type.id === id) ?? null),
    },
  });
  return { ProductModel, ProductCategoryModel, links, products, service };
};

const shopifyProduct = (): FakeProduct => ({
  id: 1,
  image: "https://cdn/x.png",
  isCatalogProduct: true,
  shopifyId: "7001",
  status: 1,
  title: "دريسينج شوبيفاي",
  typeId: 3,
  variants: [
    { color: "أبيض", cost: 100, material: "خشب", price: 500, shopifyId: "8001", size: "L", sku: "RKA-001", title: "أبيض" },
    { color: "أسود", cost: 110, material: "خشب", price: 520, shopifyId: "8002", size: "L", sku: "RKA-002", title: "أسود" },
  ],
  vendorId: 4,
  categories: [{ categoryId: 11 }, { categoryId: 12 }],
});

const allowFinancials = { canEditFinancials: true };
const noFinancials = { canEditFinancials: false };

describe("createSystemProduct", () => {
  it("creates a system product without Shopify ids and with local variant ids", async () => {
    const { service, ProductModel } = buildService();
    const result = await service.createSystemProduct(
      { title: "جديد", vendorId: 4, typeId: 3, image: null, variants: [{ price: 900, cost: 400, sku: "NEW-1", color: null, material: null, size: null, title: null }] },
      allowFinancials,
    );
    expect(result.statusCode).toBe(201);
    const created = ProductModel.create.mock.calls[0]![0];
    expect(created).toMatchObject({ isCatalogProduct: true, isSystemCreated: true, shopifyId: null, vendorId: 4, typeId: 3, title: "جديد" });
    expect(created.image).toContain("default-product.png");
    expect(created.variants[0]).toMatchObject({ sku: "NEW-1", price: 900, cost: 400 });
    expect(created.variants[0].id).toMatch(/^local-/);
    expect(created.variants[0]).not.toHaveProperty("shopifyId");
  });

  it("generates a unique sku when none is given", async () => {
    const { service, ProductModel } = buildService();
    await service.createSystemProduct(
      { title: "ا", vendorId: 4, typeId: null, image: null, variants: [{ price: 1, sku: null, color: null, material: null, size: null, title: null }] },
      allowFinancials,
    );
    expect(ProductModel.create.mock.calls[0]![0].variants[0].sku).toMatch(/^SYS-[0-9A-Z]{6}-C\d+$/);
  });

  it("rejects a sku already used by another product with 409", async () => {
    const { service } = buildService([shopifyProduct()]);
    await expect(service.createSystemProduct(
      { title: "ا", vendorId: 4, typeId: null, image: null, variants: [{ price: 1, sku: "rka-001", color: null, material: null, size: null, title: null }] },
      allowFinancials,
    )).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects an unknown vendor with 400", async () => {
    const { service } = buildService();
    await expect(service.createSystemProduct(
      { title: "ا", vendorId: 77, typeId: null, image: null, variants: [{ price: 1, sku: null, color: null, material: null, size: null, title: null }] },
      allowFinancials,
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it("forbids setting a cost without the financial permission, but allows price", async () => {
    const { service, ProductModel } = buildService();
    const variant = { price: 50, sku: "P-1", color: null, material: null, size: null, title: null };
    await expect(service.createSystemProduct(
      { title: "ا", vendorId: 4, typeId: null, image: null, variants: [{ ...variant, cost: 10 }] }, noFinancials,
    )).rejects.toMatchObject({ statusCode: 403 });
    await service.createSystemProduct({ title: "ا", vendorId: 4, typeId: null, image: null, variants: [variant] }, noFinancials);
    expect(ProductModel.create).toHaveBeenCalledTimes(1);
  });
});

describe("duplicateProduct", () => {
  it("copies fields and category links but not Shopify ids, with unique codes", async () => {
    const { service, ProductModel, links } = buildService([shopifyProduct()]);
    const result = await service.duplicateProduct(1, {}, allowFinancials);
    expect(result.statusCode).toBe(201);
    const created = ProductModel.create.mock.calls[0]![0];
    expect(created).toMatchObject({
      image: "https://cdn/x.png", isCatalogProduct: true, isSystemCreated: true, shopifyId: null,
      status: 1, title: "دريسينج شوبيفاي", typeId: 3, vendorId: 4,
    });
    expect(created.variants.map((variant: FakeProduct) => variant.sku)).toEqual(["RKA-001-C1", "RKA-002-C1"]);
    expect(created.variants[0]).toMatchObject({ color: "أبيض", cost: 100, material: "خشب", price: 500, size: "L", title: "أبيض" });
    for (const variant of created.variants) {
      expect(variant).not.toHaveProperty("shopifyId");
      expect(variant.id).toMatch(/^local-/);
    }
    expect(links).toEqual([
      { categoryId: 11, productId: 100, shopifyId: null },
      { categoryId: 12, productId: 100, shopifyId: null },
    ]);
  });

  it("duplicating twice yields distinct codes", async () => {
    const { service, ProductModel } = buildService([shopifyProduct()]);
    await service.duplicateProduct(1, {}, allowFinancials);
    await service.duplicateProduct(1, {}, allowFinancials);
    expect(ProductModel.create.mock.calls[1]![0].variants[0].sku).toBe("RKA-001-C2");
  });

  it("applies the edited name, price and code over the copy", async () => {
    const { service, ProductModel } = buildService([shopifyProduct()]);
    await service.duplicateProduct(
      1,
      { title: "اسم جديد", variants: [{ price: 777, sku: "MY-CODE", cost: 100, color: "أبيض", material: "خشب", size: "L", title: "أبيض" }] },
      allowFinancials,
    );
    const created = ProductModel.create.mock.calls[0]![0];
    expect(created.title).toBe("اسم جديد");
    expect(created.variants).toHaveLength(1);
    expect(created.variants[0]).toMatchObject({ price: 777, sku: "MY-CODE" });
  });

  it("rejects an explicit code that is already taken", async () => {
    const { service } = buildService([shopifyProduct()]);
    await expect(service.duplicateProduct(
      1, { variants: [{ price: 1, sku: "RKA-002", color: null, material: null, size: null, title: null }] }, allowFinancials,
    )).rejects.toMatchObject({ statusCode: 409 });
  });

  it("without the financial permission: keeps copied cost, forbids changing it", async () => {
    const { service, ProductModel } = buildService([shopifyProduct()]);
    await service.duplicateProduct(1, {}, noFinancials);
    expect(ProductModel.create.mock.calls[0]![0].variants[0].cost).toBe(100);
    await expect(service.duplicateProduct(
      1, { variants: [{ price: 5, cost: 1, sku: null, color: null, material: null, size: null, title: null }] }, noFinancials,
    )).rejects.toMatchObject({ statusCode: 403 });
    // re-sending the unchanged cost is not a change
    await expect(service.duplicateProduct(
      1, { variants: [{ price: 5, cost: 100, sku: null, color: null, material: null, size: null, title: null }] }, noFinancials,
    )).resolves.toMatchObject({ statusCode: 201 });
  });

  it("404s for a missing source or a per-order copy that is not a catalogue product", async () => {
    const { service } = buildService([{ ...shopifyProduct(), id: 2, isCatalogProduct: false }]);
    await expect(service.duplicateProduct(55, {}, allowFinancials)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.duplicateProduct(2, {}, allowFinancials)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("Shopify sync guard", () => {
  it("never updates a system-created product, even if a payload matches its key", async () => {
    const system = { ...shopifyProduct(), id: 5, isSystemCreated: true, shopifyId: "9999", update: jest.fn() };
    const { service, ProductModel } = buildService([system]);
    await service.saveProductToDB(
      [{ id: 9999, title: "من شوبيفاي", variants: [], vendor: "ركنة" }],
      { "ركنة": { id: 4 } },
      {},
    );
    expect(system.update).not.toHaveBeenCalled();
    expect(ProductModel.create).not.toHaveBeenCalled();
  });

  it("still updates a normal Shopify product", async () => {
    const regular = { ...shopifyProduct(), id: 6, update: jest.fn() };
    const { service } = buildService([regular]);
    await service.saveProductToDB([{ id: 7001, title: "جديد", variants: [], vendor: "ركنة" }], { "ركنة": { id: 4 } }, {});
    expect(regular.update).toHaveBeenCalledWith(expect.objectContaining({ title: "جديد" }));
  });

  it("system products have no Shopify id, so a Shopify id lookup can never match them", async () => {
    const { service, ProductModel } = buildService();
    await service.createSystemProduct(
      { title: "ا", vendorId: 4, typeId: null, image: null, variants: [{ price: 1, sku: "S-1", color: null, material: null, size: null, title: null }] },
      allowFinancials,
    );
    const found = await ProductModel.findOne({ where: { shopifyId: "7001" } });
    expect(found).toBeNull();
  });
});

describe("getProductsMappedByShopifyIds with local keys", () => {
  it("maps local:<id> products without calling Shopify", async () => {
    const { service, ProductModel } = buildService();
    const localProduct = { id: 12, shopifyId: null, vendorId: 4, variants: [], vendor: { id: 4 }, isSystemCreated: true };
    (ProductModel as any).findAll = jest.fn().mockImplementation(async ({ where }: { where: FakeProduct }) =>
      (where.id ? [localProduct] : []));
    const { productsMap } = await service.getProductsMappedByShopifyIds(["local:12"]);
    expect(productsMap["local:12"]).toBe(localProduct);
  });

  it("404s for an unknown local product", async () => {
    const { service, ProductModel } = buildService();
    (ProductModel as any).findAll = jest.fn().mockResolvedValue([]);
    await expect(service.getProductsMappedByShopifyIds(["local:404"])).rejects.toMatchObject({ statusCode: 404 });
  });
});
