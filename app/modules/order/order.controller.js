const { AppError } = require("../../middlewares/errors");
const OrderService = require("./order.service");

class OrderController {
  static async createOrder(req, res) {
    try {
      const result = await OrderService.saveImportedOrders(
        [req.body],
        false,
        req.user
      );
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
  static async exportOrders(req, res, next) {
    try {
      let vendorUser = false;
      if (req.vendorId) {
        req.query.vendorId = req.vendorId;
        vendorUser = true;
      }
      await OrderService.exportOrders(res, {
        ...req.query,
        vendorUser,
      });
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async importOrders(req, res, next) {
    try {
      const result = await OrderService.importOrders({},true);
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

      const result = await OrderService.updateOrder(
        orderId,
        req.body,
        req.user
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async BulkUpdate(req, res, next) {
    try {
      const result = await OrderService.BulkUpdate(req.body, req.user);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async deleteOrder(req, res, next) {
    try {
      const { orderId } = req.params;
      const result = await OrderService.deleteOrder(orderId);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async bulkDelete(req, res, next) {
    try {
      const result = await OrderService.bulkDelete(req.body);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async updateNote(req, res, next) {
    try {
      const { orderId, noteId } = req.params;
      const { text } = req.body;
      const result = await OrderService.updateNote(
        req.user,
        orderId,
        noteId,
        text
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async addNote(req, res, next) {
    try {
      const { orderId } = req.params;
      const { text } = req.body;

      const result = await OrderService.addNote(req.user, orderId, text);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async deleteNote(req, res, next) {
    try {
      const { orderId, noteId } = req.params;
      const result = await OrderService.deleteNote(req.user, orderId, noteId);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async uploadFiles(req, res, next) {
    try {
      const noteId = req.params.id;
      const { filePaths, fileNames, descriptions } = req;
      let note = await OrderService.uploadFiles(
        noteId,
        filePaths,
        fileNames,
        descriptions
      );
      res.status(200).json(note);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = OrderController;
