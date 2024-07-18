const { AppError } = require("../../middlewares/errors");
const OrderService = require("./order.service");

class OrderController {


  static async importOrders(req, res, next) {
    try {
      const result = await OrderService.importOrders();
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getOrders(req, res, next) {
    try {
      const { page, size,searchQuery } = req.query;
      const result = await OrderService.getOrders(page, size,searchQuery);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = OrderController;