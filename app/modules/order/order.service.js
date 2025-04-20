const { Op, where, or } = require("sequelize");
const CustomerService = require("../customer/customer.service");
const ShopifyHelper = require("../helpers/shopifyHelper");
const OrderLine = require("../orderLines/orderline.model");
const Product = require("../product/product.model");
const ProductsService = require("../product/product.service");
const Order = require("./order.model");
const { sequelize } = require("../../../config/db.config");
const Vendor = require("../vendor/vendor.model");
const Customer = require("../customer/customer.model");
const Note = require("../notes/notes.model");
const User = require("../user/user.model");
const { ORDER_STATUS, USER_TYPES } = require("../../../config/constants");
const moment = require("moment-timezone");
const PREFIX = "H";
const CUSTOM_PREFIX = "CU";

class OrderService {
  static async importOrders() {
    const fields = [];
    const orders = await ShopifyHelper.importData("orders", fields, {
      status: "any",
    });
    const result = await OrderService.saveImportedOrders(orders);
    return result;
  }
  static async saveImportedOrders(orders) {
    const productsIds = new Set();
    const customers = [];
    const lastOrder = await Order.findOne({
      order: [["createdAt", "DESC"]],
      attributes: ["code"],
    });
    const lastCustomOrder = await Order.findOne({
      where: {
        custom: true,
      },
      order: [["createdAt", "DESC"]],
      attributes: ["number"],
    });

    // Get last code number or default to 0
    const lastCode = lastOrder?.code || `${PREFIX}0`;
    const codeNumber = parseInt(lastCode.replace(PREFIX, ""), 10);

    // Get last custom code number or default to 0
    let lastCustomNumber = lastCustomOrder ? lastCustomOrder.number : 0;

    if (isNaN(codeNumber)) {
      throw new Error("Invalid order code format");
    }
    let nextNumber = codeNumber + 1;

    for (const order of orders) {
      for (const line of order.line_items) {
        if (line.product_id) {
          productsIds.add(String(line.product_id));
        }
      }
      if (order.customer) {
        customers.push(order.customer);
      }
    }
    const [productsMap, customersIdsMap] = await Promise.all([
      ProductsService.getProductsMappedByShopifyIds([...productsIds]),
      CustomerService.getCustomersMappedByNames(customers),
    ]);

    const lines = [];

    orders = orders
      .filter((order) => order.customer)
      .map((order) => {
        let totalCost = 0;
        order.line_items.forEach((line) => {
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
          order_id: order.id,
          line_items: order.line_items,
        });
        const customerName = `${
          order.customer.firstName ||
          order.customer.first_name ||
          order.customer.default_address.first_name
        } ${
          order.customer.lastName ||
          order.customer.last_name ||
          order.customer.default_address.last_name
        }`;
        let number,
          orderNumber,
          name,
          custom = false;
        if (order.shopifyId) {
          number = order.number;
          orderNumber = order.order_number;
          name = order.name;
        } else {
          const newNumber = parseInt(lastCustomNumber) + 1;
          number = `${newNumber}`;
          orderNumber = `${newNumber + 1000}`;
          name = `#${CUSTOM_PREFIX}${newNumber}`;
          custom = true;
        }
        return {
          shopifyId: String(order.id),
          name,
          code: `${PREFIX}${++nextNumber}`,
          number,
          orderNumber,
          subTotalPrice: order.total_line_items_price,
          totalDiscounts: order.total_discounts,
          totalTax: order.total_tax,
          shippingFees: order.shipping_lines
            ? order.shipping_lines.reduce(
                (acc, item) => acc + Number(item.price),
                0
              )
            : 0,
          totalPrice: order.total_price,
          orderDate: order.created_at || new Date(),
          customerId: customersIdsMap[customerName],
          totalCost,
          custom,
        };
      });

    const result = await Order.bulkCreate(orders, {
      updateOnDuplicate: [
        "shopifyId",
        "subTotalPrice",
        "totalDiscounts",
        "totalTax",
        "shippingFees",
        "totalPrice",
        "orderDate",
        "customerId",
        "totalCost",
      ],
    });
    const savedOrders = result.map((order) => order.toJSON());
    const orderLines = [];
    for (const { order_id, line_items } of lines) {
      const order = savedOrders.find(
        (order) => order.shopifyId === String(order_id)
      );
      for (const line of line_items) {
        orderLines.push({
          orderId: order.id,
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
        "orderId",
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
      message: "Orders imported successfully",
    };
  }
  static async getOrders({
    page = 1,
    size = 50,
    vendorName,
    vendorId,
    orderNumber,
    financialStatus,
    status,
    deliveryStatus,
    startDate,
    endDate,
    vendorUser,
  }) {
    let whereClause = {
      [Op.and]: [],
    };

    if (orderNumber) {
      whereClause[Op.and].push({
        [Op.or]: [
          sequelize.where(sequelize.fn("lower", sequelize.col("Order.name")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("number")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("orderNumber")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
        ],
      });
    }

    if (financialStatus) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize
            .fn("lower", sequelize.col("financialStatus"))
            .cast(sequelize.Sequelize.STRING),
          {
            [Op.like]: `%${financialStatus.toLowerCase()}%`,
          }
        )
      );
    }
    if (deliveryStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.deliveryStatus"), {
          [Op.eq]: deliveryStatus,
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
        sequelize.where(sequelize.col("Order.createdAt"), {
          [Op.gte]: startStartDate,
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.createdAt"), {
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
    if (vendorId && vendorId !== "0") {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
          [Op.eq]: vendorId,
        })
      );
    }

    if (vendorUser) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.gt]: ORDER_STATUS.IN_PROGRESS,
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.ne]: ORDER_STATUS.CANCELED,
        })
      );
    } else if (status) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.eq]: status,
        })
      );
    }
    whereClause = whereClause[Op.and].length ? whereClause : {};
    const orders = await Order.findAndCountAll({
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
      order: [["orderDate", "DESC"]],
      limit: Number(size),
      offset: (page - 1) * Number(size),
      subQuery: false,
    });
    return {
      status: true,
      statusCode: 200,
      data: {
        orders: orders.rows,
        totalPages: Math.ceil(orders.count / Number(size)),
      },
    };
  }
  static async financialReport(vendorId, startDate, endDate) {
    let startStartDate = startDate
      ? moment
          .tz(new Date(startDate), "Africa/Cairo")
          .startOf("day")
          .utc()
          .toDate()
      : moment().tz(new Date(), "Africa/Cairo").startOf("month").utc();
    let endOfEndDate = endDate
      ? moment.tz(new Date(endDate), "Africa/Cairo").endOf("day").utc().toDate()
      : moment().tz(new Date(), "Africa/Cairo").endOf("day").utc().toDate();

    let whereClause = {
      [Op.and]: [
        sequelize.where(sequelize.col("orderDate"), {
          [Op.gte]: startStartDate,
        }),
        sequelize.where(sequelize.col("orderDate"), {
          [Op.lte]: endOfEndDate,
        }),
      ],
    };

    if (vendorId && vendorId !== "0") {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
          [Op.eq]: vendorId,
        })
      );
    }
    const orders = await Order.findAll({
      include: [
        {
          model: OrderLine,
          required: true,
          as: "orderLines",
          include: {
            model: Product,
            as: "product",
            required: true,
            include: {
              model: Vendor,
              as: "vendor",
              required: true,
            },
          },
        },
      ],
      where: whereClause,
    });
    let totalCost = 0;
    let totalRevenue = 0;
    let totalDiscount = 0;
    let totalProfit = 0;
    let totalCommission = 0;
    let totalTax = 0;
    let count = 0;
    let totalPaid = 0;
    let subTotal = 0;
    let totalDownPayment = 0;
    let totalToBeCollected = 0;
    const DeliveredOrders = {
      ordersCount: 0,
      totalTax: 0,
      totalCost: 0,
      totalRevenue: 0,
      totalDiscount: 0,
      totalProfit: 0,
      totalCommission: 0,
      totalPaid: 0,
      subTotal: 0,
      totalDownPayment: 0,
      totalToBeCollected: 0,
    };
    const halfCompletedOrders = {
      ordersCount: 0,
      totalTax: 0,
      totalCost: 0,
      totalRevenue: 0,
      totalDiscount: 0,
      totalProfit: 0,
      totalCommission: 0,
      totalPaid: 0,
      subTotal: 0,
      totalDownPayment: 0,
      totalToBeCollected: 0,
    };
    const vendorsMap = {};
    for (const order of orders) {
      if (order.status === ORDER_STATUS.DELIVERED) {
        DeliveredOrders.ordersCount++;
        DeliveredOrders.totalTax += +order.totalTax;
        DeliveredOrders.totalCost += +order.totalCost;
        DeliveredOrders.totalRevenue += +order.totalPrice;
        DeliveredOrders.totalDiscount += +order.totalDiscounts;
        DeliveredOrders.totalProfit +=
          +order.totalPrice -
          +order.totalCost -
          +order.commission -
          +order.totalTax;
        DeliveredOrders.totalCommission += +order.commission;
        DeliveredOrders.totalPaid += +order.totalPrice;
        DeliveredOrders.subTotal += +order.subTotal;
        DeliveredOrders.totalDownPayment += +order.downPayment;
        DeliveredOrders.totalToBeCollected += +order.toBeCollected;
      }
      if (order.status === ORDER_STATUS.HALF_COMPLETED) {
        halfCompletedOrders.ordersCount++;
        halfCompletedOrders.totalTax += +order.totalTax;
        halfCompletedOrders.totalCost += +order.totalCost;
        halfCompletedOrders.totalRevenue += +order.totalPrice;
        halfCompletedOrders.totalDiscount += +order.totalDiscounts;
        halfCompletedOrders.totalProfit +=
          +order.totalPrice -
          +order.totalCost -
          +order.commission -
          +order.totalTax;
        halfCompletedOrders.totalCommission += +order.commission;
        halfCompletedOrders.totalPaid += +order.totalPrice;
        halfCompletedOrders.subTotal += +order.subTotal;
        halfCompletedOrders.totalDownPayment += +order.downPayment;
        halfCompletedOrders.totalToBeCollected += +order.toBeCollected;
      }
      for (const line of order.orderLines) {
        if (!vendorsMap[line.product.vendor.id]) {
          vendorsMap[line.product.vendor.id] = {
            vendorId: line.product.vendor.id,
            vendorName: line.product.vendor.name,
            revenue: 0,
            profit: 0,
          };
        }
        vendorsMap[line.product.vendor.id].revenue += +line.price;
        vendorsMap[line.product.vendor.id].profit +=
          +line.price - +line.cost - +line.commission - +line.tax;
      }
      count++;
      totalCost += +order.totalCost;
      totalRevenue += +order.totalPrice;
      totalDiscount += +order.totalDiscounts;
      totalCommission += +order.commission;
      totalTax += +order.totalTax;
      totalPaid += +order.totalPrice;
      subTotal += +order.subTotal;
      totalDownPayment += +order.downPayment;
      totalToBeCollected += +order.toBeCollected;
    }
    totalProfit = totalRevenue - totalCost - totalCommission - totalTax;
    return {
      status: true,
      statusCode: 200,
      data: {
        ordersCount: count,
        totalTax,
        totalCost,
        totalRevenue,
        totalDiscount,
        totalProfit,
        totalCommission,
        totalPaid,
        subTotal,
        totalDownPayment,
        totalToBeCollected,
        DeliveredOrders,
        halfCompletedOrders,
        topTenVendors: Object.values(vendorsMap)
          .sort((a, b) => {
            return b.profit - a.profit;
          })
          .slice(0, 10),
      },
    };
  }
  static async getOneOrder(orderId, vendor_Id) {
    const whereClause = {
      id: String(orderId),
    };

    if (vendor_Id) {
      whereClause["$orderLines.product.vendor.id$"] = vendor_Id;
    }
    const order = await Order.findOne({
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
      data: order,
    };
  }
  static async updateOrder(orderId, orderData) {
    //filter out the order Data
    Object.keys(orderData).forEach(
      (key) =>
        orderData[key] === undefined ||
        (orderData[key] === null && delete orderData[key])
    );
    const order = await Order.findByPk(orderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
    await order.update(orderData);
    return {
      status: true,
      statusCode: 200,
      data: order,
    };
  }

  static async deleteOrder(orderId) {
    const order = await Order.findByPk(orderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
    await order.destroy();
    return {
      status: true,
      statusCode: 200,
      message: "Order deleted successfully",
    };
  }
  static async updateNote(user, OrderId, noteId, text) {
    const order = await Order.findByPk(OrderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
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
  static async addNote(user, OrderId, text) {
    const orderId = Number(OrderId);

    const order = await Order.findByPk(orderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
    const newNote = await Note.create({
      text: text,
      userId: user.id,
      entityId: Number(orderId),
      entityType: "order",
    });
    return {
      status: true,
      statusCode: 200,
      data: newNote,
    };
  }
  static async deleteNote(user, OrderId, noteId) {
    const order = await Order.findByPk(OrderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
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
module.exports = OrderService;
