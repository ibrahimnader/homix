const { promises } = require("fs-extra");
const ShopifyHelper = require("../helpers/shopifyHelper");
const Category = require("./category.model");
const ProductCategory = require("./productCategory.model");
const shopifyClient = require("../../../config/shopify");

class CategoryService {
  static async importCategories(ids) {
    const categories = [];
    for (const id of ids) {
      const category = await shopifyClient.get({
        path: "collections/" + id,
      });
      categories.push(category.body.collection);
    }

    const result = await CategoryService.saveImportedCategories(categories);

    return result;
  }
  static async saveImportedCategories(categories) {
    const result = await CategoryService.saveCategoriesToDB(categories);
    return {
      status: true,
      message: "Categories imported successfully",
      data: result,
      statusCode: 200,
    };
  }

  static async saveCategoriesToDB(categoriesData) {
    categoriesData = categoriesData.map((category) => {
      return {
        title: category.title,
        image: category.image
          ? category.image.src
          : `${process.env.APP_URL}/uploads/default-category.png`,
        shopifyId: String(category.id),
      };
    });
    const savedCategories = await Category.bulkCreate(categoriesData, {
      updateOnDuplicate: ["shopifyId", "title", "image"],
    });
    return savedCategories;
  }

  static async saveProductsCategories(productsMap) {
    const productsIds = Object.keys(productsMap);
    const categoriesIds = [];
    const productCategoriesSet = new Set();
    const Promises = [];
    for (const productId of productsIds) {
      await CategoryService.getCollects(
        productId,
        categoriesIds,
        productCategoriesSet
      );
    }
    const categories = await Category.findAll({
      where: {
        shopifyId: [...categoriesIds, "custom"],
      },
      attributes: ["shopifyId", "id"],
    });
    const result = {};
    const existingShopifyIds = new Set();
    for (const category of categories) {
      result[category.shopifyId] = category;
      existingShopifyIds.add(category.shopifyId.toString());
    }
    const nonExistingCategoriesIds = categoriesIds.filter(
      (id) => !existingShopifyIds.has(id.toString())
    );
    if (nonExistingCategoriesIds.length > 0) {
      const idsChunks = ShopifyHelper.splitArrayToChunks(
        nonExistingCategoriesIds,
        250
      );
      for (const idChunk of idsChunks) {
        const res = await CategoryService.importCategories(idChunk);
        for (const category of res.data) {
          result[category.shopifyId] = category;
        }
      }
    }

    const productCategories = [];
    for (const key of productCategoriesSet) {
      const [id, productShopifyId, categoryShopifyId] = key.split("-");
      const product = productsMap[productShopifyId];
      const category = result[categoryShopifyId];
      productCategories.push({
        productId: product.id,
        categoryId: category.id,
        productShopifyId,
        categoryShopifyId,
        shopifyId: id,
      });
    }
    await ProductCategory.bulkCreate(productCategories, {
      updateOnDuplicate: ["productId", "categoryId"],
    });
    return result;
  }

  static async getCollects(productId, categoriesIds, productCategoriesSet) {
    const collects = await ShopifyHelper.importData(
      "collects",
      ["collection_id", "product_id", "id"],
      { product_id: productId }
    );
    [...collects].forEach((collect) => {
      categoriesIds.push(String(collect.collection_id));
      productCategoriesSet.add(
        `${String(collect.id)}-${String(collect.product_id)}-${String(
          collect.collection_id
        )}`
      );
    });
  }
}
module.exports = CategoryService;
