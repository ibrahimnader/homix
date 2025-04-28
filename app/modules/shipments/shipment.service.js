const { Op, where, or } = require("sequelize");
const CustomerService = require("../customer/customer.service");
const ShopifyHelper = require("../helpers/shopifyHelper");
const OrderLine = require("../orderLines/orderline.model");
const Product = require("../product/product.model");
const ProductsService = require("../product/product.service");
const Shipment = require("../order/order.model");
const { sequelize } = require("../../../config/db.config");
const Vendor = require("../vendor/vendor.model");
const Customer = require("../customer/customer.model");
const Note = require("../notes/notes.model");
const User = require("../user/user.model");
const { SHIPMENT_STATUS, USER_TYPES } = require("../../../config/constants");
const moment = require("moment-timezone");
const PREFIX = "H";
const CUSTOM_PREFIX = "CU";

class ShipmentService {
  static async getShipments({
    page = 1,
    size = 50,
    shippingCompany,
    governorate,
    shipmentStatus,
    shipmentType,
    startDate,
    endDate,
  }) {
    let whereClause = {
      [Op.and]: [
        {
          shippedFromInventory: true,
        },
      ],
    };
    if (shippingCompany) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("shippingCompany"), {
          [Op.like]: `%${shippingCompany}%`,
        })
      );
    }
    if (governorate) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("governorate"), {
          [Op.eq]: governorate,
        })
      );
    }

    if (shipmentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.shipmentStatus"), {
          [Op.eq]: shipmentStatus,
        })
      );
    }
    if (shipmentType) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.shipmentType"), {
          [Op.eq]: shipmentType,
        })
      );
    }
    if (startDate && endDate) {
      let startStartDate = moment
        .tz(new Date(startDate), "Africa/Cairo")
        .startOf("day")
        .utc()
        .toDate();

      let endOfEndDate = moment
        .tz(new Date(endDate), "Africa/Cairo")
        .endOf("day")
        .utc()
        .toDate();

      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.deliveryDate"), {
          [Op.gte]: startStartDate,
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.deliveryDate"), {
          [Op.lte]: endOfEndDate,
        })
      );
    }

    whereClause = whereClause[Op.and].length ? whereClause : {};
    const shipments = await Shipment.findAndCountAll({
      include: [
        {
          model: OrderLine,
          required: true,
          as: "orderLines",
          include: [
            {
              model: Product,
              as: "product",
              required: true,
              include: {
                model: Vendor,
                as: "vendor",
                required: true,
              },
            },
          ],
        },
        {
          model: Customer,
          as: "customer",
          required: false,
        },
      ],
      where: whereClause,
      shipment: [["shipmentDate", "DESC"]],
      limit: Number(size),
      offset: (page - 1) * Number(size),
      subQuery: false,
    });
    return {
      status: true,
      statusCode: 200,
      data: {
        shipments: shipments.rows,
        totalPages: Math.ceil(shipments.count / Number(size)),
      },
    };
  }
  static async getOneShipment(shipmentId, vendor_Id) {
    const whereClause = {
      id: String(shipmentId),
    };

    if (vendor_Id) {
      whereClause["$orderLines.product.vendor.id$"] = vendor_Id;
    }
    const shipment = await Shipment.findOne({
      where: whereClause,
      subQuery: false,
      include: [
        {
          model: OrderLine,
          required: true,
          as: "orderLines",
          include: [
            {
              model: Product,
              as: "product",
              required: true,
              include: {
                model: Vendor,
                as: "vendor",
                required: true,
              },
            },
          ],
        },
        {
          model: Note,
          as: "notesList",
          required: false,
          include: [
            {
              model: User,
              as: "user",
              required: false,
              attributes: ["firstName", "lastName"],
            },
          ],
        },
        {
          model: Customer,
          as: "customer",
          required: true,
        },
      ],
    });

    return {
      status: true,
      statusCode: 200,
      data: shipment,
    };
  }
  static async updateShipment(shipmentId, shipmentData) {
    //filter out the shipment Data
    Object.keys(shipmentData).forEach(
      (key) =>
        shipmentData[key] === undefined ||
        (shipmentData[key] === null && delete shipmentData[key])
    );
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment not found",
      };
    }
    await shipment.update(shipmentData);
    return {
      status: true,
      statusCode: 200,
      data: shipment,
    };
  }

  static async deleteShipment(shipmentId) {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment not found",
      };
    }
    await shipment.destroy();
    return {
      status: true,
      statusCode: 200,
      message: "Shipment deleted successfully",
    };
  }
  static async updateNote(user, ShipmentId, noteId, text) {
    const shipment = await Shipment.findByPk(ShipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment Line not found",
      };
    }
    let note = await Note.findByPk(noteId);
    if (!note) {
      return {
        status: false,
        statusCode: 404,
        message: "Note not found",
      };
    }
    if (
      user.userType === USER_TYPES.VENDOR ||
      user.id.toString() !== note.userId.toString()
    ) {
      return {
        status: false,
        statusCode: 403,
        message: "You are not authorized to update this note",
      };
    }
    note.text = text;
    await note.save();

    return {
      status: true,
      statusCode: 200,
      data: note,
    };
  }
  static async addNote(user, ShipmentId, text) {
    const shipmentId = Number(ShipmentId);

    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment not found",
      };
    }
    const newNote = await Note.create({
      text: text,
      userId: user.id,
      entityId: Number(shipmentId),
      entityType: "shipment",
    });
    return {
      status: true,
      statusCode: 200,
      data: newNote,
    };
  }
  static async deleteNote(user, ShipmentId, noteId) {
    const shipment = await Shipment.findByPk(ShipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment Line not found",
      };
    }
    const note = await Note.findByPk(noteId);
    if (!note) {
      return {
        status: false,
        statusCode: 404,
        message: "Note not found",
      };
    }
    if (
      user.userType === USER_TYPES.VENDOR ||
      user.id.toString() !== note.userId.toString()
    ) {
      return {
        status: false,
        statusCode: 403,
        message: "You are not authorized to update this note",
      };
    }
    await Note.destroy({ where: { id: noteId } });
    return {
      status: true,
      statusCode: 200,
      message: "Note deleted successfully",
    };
  }
}
module.exports = ShipmentService;
