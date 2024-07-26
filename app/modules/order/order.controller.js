const { AppError } = require("../../middlewares/errors");
const OrderService = require("./order.service");

class OrderController {
  static async createOrder(req, res, next) {
    try {
      const result = await OrderService.createOrder(req.body);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
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
      const {
        page = 1,
        size = 50,
        orderNumber = "",
        financialStatus = "",
        status,
        vendorName = "",
      } = req.query;

      const vendor_Id = req.vendorId;
      const result = await OrderService.getOrders({
        page,
        size,
        orderNumber,
        financialStatus,
        status,
        vendorName,
        vendorId: vendor_Id,
      });
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getOneOrder(req, res, next) {
    try {
      const { orderId } = req.params;
      const result = await OrderService.getOneOrder(orderId);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = OrderController;
