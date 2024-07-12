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
      const { page, size } = req.query;
      const result = await productsService.getProducts(page, size);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}

module.exports = productsController;
