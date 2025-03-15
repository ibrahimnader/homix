const { where } = require("sequelize");
const shopifyClient = require("../../../config/shopify");
const VendorsService = require("../vendor/vendor.service");
const Product = require("./product.model");
const ShopifyHelper = require("../helpers/shopifyHelper");
const Vendor = require("../vendor/vendor.model");
const { Op } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const { saveProductsCategories } = require("../category/categoty.service");
const ProductCategory = require("../category/productCategory.model");
const Category = require("../category/category.model");

class ProductsService {
  static async getProducts(
    page = 1,
    size = 50,
    searchQuery = "",
    vendorsId,
    categories
  ) {
    // search if product title contains search query or product vendor contains search query or product variant title contains search query

    const whereClause = {};
    if (categories?.length) {
      const validCategories = categories
        .map((id) => Number(id))
        .filter(Boolean);

      const productIds = await ProductCategory.findAll({
        attributes: ["productId"],
        where: {
          categoryId: {
            [Op.in]: validCategories,
          },
        },
        group: ["productId"],
      });

      whereClause.id = {
        [Op.in]: productIds.map((p) => p.productId),
      };
    }

    const products = await Product.findAndCountAll({
      include: [
        {
          model: Vendor,
          as: "vendor",
          attributes: ["name"],

          where:
            vendorsId && vendorsId.length
              ? { id: { [Op.in]: vendorsId.map((id) => Number(id)) } }
              : {},
          required: true,
        },
        {
          model: ProductCategory,
          attributes: ["categoryId"],
          as: "categories",
          include: [
            {
              model: Category,
              as: "category",
              attributes: ["title"],
            },
          ],
          required: false,
        },
      ],
      where: {
        ...whereClause,
        // ...(vendorId ? { vendorId } : {}),
        ...(searchQuery
          ? {
              [Op.or]: [
                sequelize.where(
                  sequelize.fn("lower", sequelize.col("Product.title")),
                  {
                    [Op.like]: `%${searchQuery.toLowerCase()}%`,
                  }
                ),
                sequelize.where(
                  sequelize.fn("lower", sequelize.col("vendor.name")),
                  {
                    [Op.like]: `%${searchQuery.toLowerCase()}%`,
                  }
                ),
              ],
            }
          : {}),
      },
      distinct: true,
      limit: Number(size),
      offset: (page - 1) * Number(size),
    });
    return {
      status: true,
      statusCode: 200,
      data: {
        products: products.rows,
        totalPages: Math.ceil(products.count / Number(size)),
      },
    };
  }
  static async getOneProduct(id) {
    const product = await Product.findByPk(id, {
      include: [
        {
          model: Vendor,
          as: "vendor",
          attributes: ["name"],
        },
        {
          model: ProductCategory,
          as: "categories",
          include: [
            {
              model: Category,
              as: "category",
              attributes: ["title"],
            },
          ],
        },
      ],
    });
    return {
      status: true,
      statusCode: 200,
      data: product,
    };
  }
  static async getProductsMappedByShopifyIds(productsIds) {
    const products = await Product.findAll({
      where: {
        shopifyId: [...productsIds, "custom"],
      },
      attributes: ["shopifyId", "id", "variants"],
    });
    const result = {};
    const existingShopifyIds = new Set();
    for (const product of products) {
      result[product.shopifyId] = product;
      existingShopifyIds.add(product.shopifyId.toString());
    }
    const nonExistingProductsIds = productsIds.filter(
      (id) => !existingShopifyIds.has(id.toString())
    );
    if (nonExistingProductsIds.length > 0) {
      const res = await ProductsService.importProducts({
        ids: nonExistingProductsIds.join(","),
      });
      for (const product of res.data) {
        result[product.shopifyId] = product;
      }
    }
    return result;
  }
  static async importProducts(parameters) {
    const fields = [
      "id",
      "title",
      "vendor",
      "variants",
      "image",
      "collection_id",
    ];
    const products = await ShopifyHelper.importData(
      "products",
      fields,
      parameters
    );

    const result = await ProductsService.saveImportedProducts(products);

    return result;
  }
  static async getInventoryMap(itemsIds) {
    const inventoryMap = {};
    const itemsIdsChunks = ShopifyHelper.splitArrayToChunks(itemsIds, 250);
    for (const itemsIdsChunk of itemsIdsChunks) {
      const inventory = await ShopifyHelper.importData(
        "inventory_items",
        ["id", "cost"],
        {
          ids: itemsIdsChunk.join(","),
        }
      );
      for (const item of inventory) {
        inventoryMap[item.id.toString()] = item.cost;
      }
    }
    return inventoryMap;
  }

  static async saveImportedProducts(products) {
    const vendorsNames = products.map((product) => product.vendor);
    const vendorsMap = await VendorsService.getExistingVendorsMap(vendorsNames);

    const result = await ProductsService.saveProductToDB(products, vendorsMap);
    const productsMap = {};
    result.forEach((product) => {
      productsMap[String(product.shopifyId)] = product;
    });
    await saveProductsCategories(productsMap);
    return {
      status: true,
      message: "Products imported successfully",
      data: result,
      statusCode: 200,
    };
  }

  static async createProduct(productData) {
    let vendor = await VendorsService.getVendorByNameAndSaveIfNotExist(
      productData.vendor
    );
    const result = await ProductsService.saveProductToDB([productData], {
      [productData.vendor]: vendor.id,
    });
    return {
      status: true,
      message: "Product created successfully",
      data: result[0],
      statusCode: 200,
    };
  }

  static async saveProductToDB(productsData, vendorsMap) {
    const itemsIds = productsData
      .map((product) =>
        product.variants
          .filter((variant) => variant.inventory_item_id)
          .map((variant) => variant.inventory_item_id)
      )
      .flat();

    let inventoryMap = {};
    if (itemsIds.length > 0) {
      inventoryMap = await ProductsService.getInventoryMap(itemsIds);
    }

    productsData = productsData.map((product) => {
      return {
        title: product.title,
        vendorId: vendorsMap[product.vendor],
        image: product.image
          ? product.image.src
          : `${process.env.APP_URL}/uploads/default-product.png`,
        shopifyId: String(product.id),
        variants: product.variants.map((variant) => {
          return {
            title: variant.title,
            price: variant.price,
            sku: variant.sku,
            shopifyId: String(variant.id),
            cost:
              variant.inventory_item_id &&
              inventoryMap[variant.inventory_item_id.toString()]
                ? Number(inventoryMap[variant.inventory_item_id.toString()])
                : 0,
          };
        }),
      };
    });

    const savedProducts = await Product.bulkCreate(productsData, {
      updateOnDuplicate: [
        "shopifyId",
        "title",
        "vendorId",
        "image",
        "variants",
      ],
    });

    return savedProducts;
  }
}
module.exports = ProductsService;
