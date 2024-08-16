const { AppError } = require("../../middlewares/errors");
const OrderLineService = require("./orderLine.service");
const OrderService = require("./orderLine.service");

class OrderLineController {
  static async updateOrderLine(req, res, next) {
    try {
      const { orderLineId } = req.params;
      const { notes, status } = req.body;

      const result = await OrderLineService.updateOrderLine(orderLineId, {
        notes,
        status,
      });
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async updateNote(req, res, next) {
    try {
      const { orderLineId, noteId } = req.params;
      const { text } = req.body;
      const result = await OrderLineService.updateNote(
        req.user,
        orderLineId,
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
      const { orderLineId } = req.params;
      const { text } = req.body;

      const result = await OrderLineService.addNote(
        req.user,
        orderLineId,
        text
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async deleteNote(req, res, next) {
    try {
      const { orderLineId, noteId } = req.params;
      const result = await OrderLineService.deleteNote(
        req.user,
        orderLineId,
        noteId
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = OrderLineController;
