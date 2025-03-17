const { AppError } = require("../../middlewares/errors");
const OrderService = require("./order.service");

class OrderController {
  static async createOrder(req, res) {
    try {
      const result = await OrderService.saveImportedOrders([req.body]);
      return res.status(200).json({
        status: true,
        message: "Order created successfully",
      });
    } catch (error) {
      return res.status(200).json({
        status: false,
        message: `order Webhook received With Error",${error.message}`,
      });
    }
  }
  static async importOrders(req, res, next) {
    try {
      const result = await OrderService.importOrders();
      res.status(result.statusCode).json(result);
    } catch (error) {
      console.log(error);
      return next(new AppError(error.message, 500));
    }
  }
  static async getOrders(req, res, next) {
    try {
      let vendorUser = false;
      if (req.vendorId) {
        req.query.vendorId = req.vendorId;
        vendorUser = true;
      }
      const result = await OrderService.getOrders({
        ...req.query,
        vendorUser,
      });
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async financialReport(req, res, next) {
    try {
      const { vendorId, startDate, endDate } = req.query;

      const vendor_Id = req.vendorId || vendorId;
      const result = await OrderService.financialReport(
        vendor_Id,
        startDate,
        endDate
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getOneOrder(req, res, next) {
    try {
      const { orderId } = req.params;
      const vendor_Id = req.vendorId;

      const result = await OrderService.getOneOrder(orderId, vendor_Id);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async updateOrder(req, res, next) {
    try {
      const { orderId } = req.params;
      const {
        receivedAmount,
        paymentStatus,
        commission,
        PoDate,
        notes,
        status,
        downPayment,
        toBeCollected,
      } = req.body;

      const result = await OrderService.updateOrder(orderId, {
        status,
        receivedAmount,
        paymentStatus,
        commission,
        PoDate,
        notes,
        downPayment,
        toBeCollected,
      });
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = OrderController;
