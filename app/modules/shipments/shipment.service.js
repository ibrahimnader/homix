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
  static async saveShipments(shipments) {
    const productsIds = new Set();
    const customers = [];
    const lastShipment = await Shipment.findOne({
      shipment: [["createdAt", "DESC"]],
      attributes: ["code"],
    });
    const lastCustomShipment = await Shipment.findOne({
      where: {
        custom: true,
      },
      shipment: [["createdAt", "DESC"]],
      attributes: ["number"],
    });

    // Get last code number or default to 0
    const lastCode = lastShipment?.code || `${PREFIX}0`;
    const codeNumber = parseInt(lastCode.replace(PREFIX, ""), 10);

    // Get last custom code number or default to 0
    let lastCustomNumber = lastCustomShipment ? lastCustomShipment.number : 0;

    if (isNaN(codeNumber)) {
      throw new Error("Invalid shipment code format");
    }
    let nextNumber = codeNumber + 1;

    for (const shipment of shipments) {
      for (const line of shipment.line_items) {
        if (line.product_id) {
          productsIds.add(String(line.product_id));
        }
      }
      if (shipment.customer) {
        customers.push(shipment.customer);
      }
    }
    const [productsMap, customersIdsMap] = await Promise.all([
      ProductsService.getProductsMappedByShopifyIds([...productsIds]),
      CustomerService.getCustomersMappedByNames(customers),
    ]);

    const lines = [];

    shipments = shipments
      .filter((shipment) => shipment.customer)
      .map((shipment) => {
        let totalCost = 0;
        shipment.line_items.forEach((line) => {
          const discount_allocations = line.discount_allocations || [];
          const lineDiscount = discount_allocations.reduce(
            (acc, item) => acc + Number(item.amount),
            0
          );
          line.discount = lineDiscount;
          const product = line.product_id
            ? productsMap[line.product_id]
            : productsMap["custom"];
          if (!product) {
            console.log("product not found", line.product_id);
          }

          const variant = product.variants
            ? product.variants.find(
                (variant) =>
                  variant.shopifyId.toString() === line.variant_id.toString()
              )
            : null;
          const cost = variant ? Number(variant.cost) || 0 : 0;
          line.unitCost = cost;
          line.cost = cost * line.quantity;
          totalCost += line.cost;
        });
        lines.push({
          shipment_id: shipment.id,
          line_items: shipment.line_items,
        });
        const customerName = `${
          shipment.customer.firstName ||
          shipment.customer.first_name ||
          shipment.customer.default_address.first_name
        } ${
          shipment.customer.lastName ||
          shipment.customer.last_name ||
          shipment.customer.default_address.last_name
        }`;
        let number,
          shipmentNumber,
          name,
          custom = false;
        if (shipment.shopifyId) {
          number = shipment.number;
          shipmentNumber = shipment.shipment_number;
          name = shipment.name;
        } else {
          const newNumber = parseInt(lastCustomNumber) + 1;
          number = `${newNumber}`;
          shipmentNumber = `${newNumber + 1000}`;
          name = `#${CUSTOM_PREFIX}${newNumber}`;
          custom = true;
        }
        return {
          shopifyId: String(shipment.id),
          name,
          code: `${PREFIX}${nextNumber}`,
          number,
          shipmentNumber,
          subTotalPrice: shipment.total_line_items_price,
          totalDiscounts: shipment.total_discounts,
          totalTax: shipment.total_tax,
          shippingFees: shipment.shipping_lines
            ? shipment.shipping_lines.reduce(
                (acc, item) => acc + Number(item.price),
                0
              )
            : 0,
          totalPrice: shipment.total_price,
          shipmentDate: shipment.created_at || new Date(),
          customerId: customersIdsMap[customerName],
          totalCost,
          custom,
          shippedFromInventory: true,
        };
      });

    const result = await Shipment.bulkCreate(shipments, {
      updateOnDuplicate: [
        "shopifyId",
        "subTotalPrice",
        "totalDiscounts",
        "totalTax",
        "shippingFees",
        "totalPrice",
        "shipmentDate",
        "customerId",
        "totalCost",
      ],
    });
    const savedShipments = result.map((shipment) => shipment.toJSON());
    const orderLines = [];
    for (const { shipment_id, line_items } of lines) {
      const shipment = savedShipments.find(
        (shipment) => shipment.shopifyId === String(shipment_id)
      );
      for (const line of line_items) {
        orderLines.push({
          shipmentId: shipment.id,
          productId: line.product_id
            ? productsMap[line.product_id].id
            : productsMap["custom"].id,
          shopifyId: String(line.id),
          title: line.title,
          name: line.name,
          price: line.price,
          quantity: line.quantity,
          sku: line.sku,
          variant_id: line.variant_id,
          discount: line.discount,
          cost: line.cost,
          unitCost: line.unitCost,
        });
      }
    }
    await OrderLine.bulkCreate(orderLines, {
      updateOnDuplicate: [
        "shopifyId",
        "shipmentId",
        "productId",
        "title",
        "name",
        "price",
        "quantity",
        "sku",
        "variant_id",
        "discount",
        "cost",
        "unitCost",
      ],
    });
    return {
      status: true,
      statusCode: 200,
      message: "Shipments imported successfully",
    };
  }
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
      [Op.and]: [],
    };
    if(shippingCompany){
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("shippingCompany"), {
          [Op.like]: `%${shippingCompany}%`,
        })
      );
    }
    if(governorate){
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("governorate"), {
          [Op.eq]: governorate,
        })
      );
    }

    if (shipmentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Shipment.shipmentStatus"), {
          [Op.eq]: shipmentStatus,
        })
      );
    }
    if (shipmentType) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Shipment.shipmentType"), {
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
        sequelize.where(sequelize.col("Shipment.deliveryDate"), {
          [Op.gte]: startStartDate,
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Shipment.deliveryDate"), {
          [Op.lte]: endOfEndDate,
        })
      );
    }
    if (vendorName) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize.fn(
            "lower",
            sequelize.col("orderLines.product.vendor.name")
          ),
          {
            [Op.like]: `%${vendorName.toLowerCase()}%`,
          }
        )
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
