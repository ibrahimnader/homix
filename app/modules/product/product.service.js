const { where } = require("sequelize");
const shopifyClient = require("../../../config/shopify");
const VendorsService = require("../vendor/vendor.service");
const Product = require("./product.model");
const ShopifyHelper = require("../helpers/shopifyHelper");
const Vendor = require("../vendor/vendor.model");
const { Op } = require("sequelize");
const { sequelize } = require("../../../config/db.config");

class ProductsService {
  static async importProducts(parameters) {
    const fields = ["id", "title", "vendor", "variants", "image"];
    const products = await ShopifyHelper.importData(
      "products",
      fields,
      parameters
    );

    const result = await ProductsService.saveImportedProducts(products);
    return result;
  }
  static async saveImportedProducts(products) {
    const vendorsSet = new Set();
    const nonExistingVendors = [];
    for (const product of products) {
      vendorsSet.add(product.vendor);
    }
    const vendors = [...vendorsSet];
    const existingVendors = await VendorsService.getExistingVendorsNames(
      vendors
    );
    const existingVendorsSet = new Set();
    const vendorsMap = new Map();
    for (const vendor of existingVendors) {
      existingVendorsSet.add(vendor.name);
      vendorsMap.set(vendor.name, vendor.id);
    }
    for (const vendor of vendors) {
      if (!existingVendorsSet.has(vendor)) {
        nonExistingVendors.push(vendor);
      }
    }
    if (nonExistingVendors.length > 0) {
      const newVendors = await VendorsService.saveVendors(nonExistingVendors);
      for (const vendor of newVendors) {
        vendorsMap.set(vendor.name, vendor.id);
      }
    }
    const existingProducts = await Product.findAll({
      where: {
        shopifyId: products.map((product) => String(product.id)),
      },
      attributes: ["shopifyId"],
    });
    const existingShopifyIds = new Set();
    for (const product of existingProducts) {
      existingShopifyIds.add(product.shopifyId);
    }

    products = products
      .filter((product) => !existingShopifyIds.has(String(product.id)))
      .map((product) => {
        return {
          title: product.title,
          vendorId: vendorsMap.get(product.vendor),
          image: product.image ? product.image.src : null,
          shopifyId: String(product.id),
          variants: product.variants.map((variant) => {
            return {
              title: variant.title,
              price: variant.price,
              sku: variant.sku,
              shopifyId: String(variant.id),
            };
          }),
        };
      });

    const importData = await Product.bulkCreate(products, {
      updateOnDuplicate: ["shopifyId"],
    });
    return {
      status: true,
      message: "Products imported successfully",
      data: importData,
      statusCode: 200,
    };
  }
  static async getProducts(page = 1, size = 50, searchQuery = "", vendorId) {
    // search if product title contains search query or product vendor contains search query or product variant title contains search query
    const products = await Product.findAndCountAll({
      include: [
        {
          model: Vendor,
          as: "vendor",
          attributes: ["name"],
          where: vendorId ? { id: vendorId } : {},
          required: true,
        },
      ],
      where: searchQuery
        ? {
            [Op.or]: [
              sequelize.where(sequelize.fn("lower", sequelize.col("title")), {
                [Op.like]: `%${searchQuery.toLowerCase()}%`,
              }),
              sequelize.where(
                sequelize.fn("lower", sequelize.col("vendor.name")),
                {
                  [Op.like]: `%${searchQuery.toLowerCase()}%`,
                }
              ),
            ],
          }
        : {},
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
        shopifyId: productsIds,
      },
      attributes: ["shopifyId", "id"],
    });
    const result = {};
    const existingShopifyIds = new Set();
    for (const product of products) {
      result[product.shopifyId] = product.id;
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
        result[product.shopifyId] = product.id;
      }
    }
    return result;
  }
  static async createProduct(productData) {
    console.log(productData);
    let vendor = await VendorsService.getVendorByNameAndSaveIfNotExist(
      productData.vendor
    );
    console.log(vendor);
    const product = await Product.create({
      title: productData.title,
      vendorId: vendor.id,
      image: productData.image ? productData.image.src : null,
      shopifyId: String(productData.id),
      variants: productData.variants.map((variant) => {
        return {
          title: variant.title,
          price: variant.price,
          sku: variant.sku,
          shopifyId: String(variant.id),
        };
      }),
    });
    console.log(product);
    return {
      status: true,
      message: "Product created successfully",
      data: product,
      statusCode: 200,
    };
  }
}
module.exports = ProductsService;
