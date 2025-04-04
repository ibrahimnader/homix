const { AppError } = require("../../middlewares/errors");
const productsService = require("./product.service");

class productsController {
  static async importProducts(req, res, next) {
    try {
      await productsService.importProducts();
      res.status(200).json({
        status: true,
        message: "Products imported successfully",
        statusCode: 200,
      });
    } catch (error) {
      console.log(error);
      return next(new AppError(error.message, 500));
    }
  }
  static async getProducts(req, res, next) {
    try {
      const { page, size, searchQuery } = req.query;
      const vendorFromToken = req.vendorId;
      let vendors = [];
      if (vendorFromToken) {
        vendors = [vendorFromToken];
      } else {
        vendors = req.query.vendorsIds ? req.query.vendorsIds.split(",") : [];
      }
      const categories = req.query.categoriesIds
        ? req.query.categoriesIds.split(",")
        : [];

      const result = await productsService.getProducts(
        page,
        size,
        searchQuery,
        vendors,
        categories
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getAllCategories(req, res, next) {
    try {
      const result = await productsService.getAllCategories();
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getProduct(req, res, next) {
    try {
      const { id } = req.params;
      const result = await productsService.getOneProduct(id);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async createProduct(req, res) {
    try {
      const result = await productsService.saveImportedProducts([req.body]);
      res.status(200).json({
        status: true,
        statusCode: 200,
        message: "Product created successfully",
      });
    } catch (error) {
      console.log(error);
      res.status(200).json({
        status: false,
        message: `prod Webhook received With Error",${error.message}`,
      });
    }
  }
}

module.exports = productsController;
