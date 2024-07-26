const { AppError } = require("../../middlewares/errors");
const productsService = require("./product.service");

class productsController {
  static async importProducts(req, res, next) {
    try {
      const result = await productsService.importProducts();
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getProducts(req, res, next) {
    try {
      const { page, size,searchQuery } = req.query;
      const { vendorId } = req;
      const result = await productsService.getProducts(page, size,searchQuery,vendorId);
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
  static async createProduct(req, res, next) {
    try {
      const result = await productsService.createProduct(req.body);
      console.log(result);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
      console.log(error);
    }
  }
}

module.exports = productsController;
