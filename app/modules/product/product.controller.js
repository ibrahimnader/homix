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
      const { vendorId } = req;
      const result = await productsService.getProducts(
        page,
        size,
        searchQuery,
        vendorId
      );
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
      res.status(200).send("Webhook received");
    } catch (error) {
      console.log(error);
      res.status(200).send("Webhook received");
    }
  }
}

module.exports = productsController;
