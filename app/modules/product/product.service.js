const { where } = require("sequelize");
const shopifyClient = require("../../../config/shopify");
const VendorsService = require("../vendor/vendor.service");
const Product = require("./product.model");
const ShopifyHelper = require("../helpers/shopifyHelper");

class productsService {
  static async importProducts() {
    const fields = ["id", "title", "vendor", "variants", "image"];
    const products = await ShopifyHelper.importData("products", fields);

    const result = await productsService.saveImportedProducts(products);
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
          vendor: product.vendor,
          vendorId: vendorsMap.get(product.vendor),
          image: product.image ? product.image.src : null,
          shopifyId: String(product.id),
        };
      });

    await Product.bulkCreate(products, {
      updateOnDuplicate: ["shopifyId"],
      ignoreDuplicates: true,
    });
    return {
      status: true,
      message: "Products imported successfully",
      statusCode: 200,
    };
  }
  static async getProducts(page = 1, size = 50) {
    const productsCount = await Product.count();
    const products = await Product.findAll({
      offset: (page - 1) * size,
      limit: size,
    });
    return {
      status: true,
      statusCode: 200,
      data: {
        products,
        totalPages: Math.ceil(productsCount / size),
      },
    };
  }
}
module.exports = productsService;
