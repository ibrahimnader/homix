const { AppError } = require("../../middlewares/errors");
const ShipmentService = require("./shipment.service");

class ShipmentController {
  static async createShipment(req, res) {
    try {
      const result = await ShipmentService.saveShipments([req.body]);
      return res.status(200).json({
        status: true,
        message: "Shipment created successfully",
      });
    } catch (error) {
      return res.status(200).json({
        status: false,
        message: `shipment received With Error",${error.message}`,
      });
    }
  }

  static async getShipments(req, res, next) {
    try {
      const result = await ShipmentService.getShipments(req.query);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async getOneShipment(req, res, next) {
    try {
      const { shipmentId } = req.params;
      const vendor_Id = req.vendorId;

      const result = await ShipmentService.getOneShipment(
        shipmentId,
        vendor_Id
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async updateShipment(req, res, next) {
    try {
      const { shipmentId } = req.params;
      const {
        shippingDate,
        shippingCompany,
        shippingFees,
        deliveryDate,
        governorate,
        shipmentStatus,
        shipmentType,
      } = req.body;

      const result = await ShipmentService.updateShipment(shipmentId, {
        shippingDate,
        shippingCompany,
        shippingFees,
        deliveryDate,
        governorate,
        shipmentStatus,
        shipmentType,
      });
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async deleteShipment(req, res, next) {
    try {
      const { shipmentId } = req.params;
      const result = await ShipmentService.deleteShipment(shipmentId);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async updateNote(req, res, next) {
    try {
      const { shipmentId, noteId } = req.params;
      const { text } = req.body;
      const result = await ShipmentService.updateNote(
        req.user,
        shipmentId,
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
      const { shipmentId } = req.params;
      const { text } = req.body;

      const result = await ShipmentService.addNote(req.user, shipmentId, text);
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async deleteNote(req, res, next) {
    try {
      const { shipmentId, noteId } = req.params;
      const result = await ShipmentService.deleteNote(
        req.user,
        shipmentId,
        noteId
      );
      res.status(result.statusCode).json(result);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = ShipmentController;
