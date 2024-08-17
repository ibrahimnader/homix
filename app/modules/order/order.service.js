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

class OrderService {
  static async importOrders() {
    const fields = [];
    const orders = await ShopifyHelper.importData("orders", fields);
    const result = await OrderService.saveImportedOrders(orders);
    return result;
  }
  static async saveImportedOrders(orders) {
    const productsIds = new Set();
    for (const order of orders) {
      const products = order.line_items;
      for (const product of products) {
        productsIds.add(String(product.product_id));
      }
    }
    const productsMap = await ProductsService.getProductsMappedByShopifyIds([
      ...productsIds,
    ]);
    const customers = [];
    for (const order of orders) {
      if (order.customer) {
        customers.push(order.customer);
      }
    }
    const customersIdsMap =
      await CustomerService.getCustomersMappedByShopifyIds(customers);
    const existingOrders = await Order.findAll({
      where: {
        shopifyId: orders.map((order) => String(order.id)),
      },
      attributes: ["shopifyId"],
    });
    const existingShopifyIds = new Set();
    for (const order of existingOrders) {
      existingShopifyIds.add(order.shopifyId);
    }
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
        return {
          shopifyId: String(order.id),
          name: order.name,
          number: order.number,
          orderNumber: order.order_number,
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
          orderDate: order.created_at,
          customerId: customersIdsMap[order.customer.id.toString()],
          totalCost,
        };
      });
    const result = [];
    for (const order of orders) {
      const [savedOrder] = await Order.upsert(order, {
        conflictFields: ["shopifyId"],
      });
      result.push(savedOrder);
    }
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
    for (const line of orderLines) {
      await OrderLine.upsert(line, {
        conflictFields: ["shopifyId"],
      });
    }
    return {
      status: true,
      statusCode: 200,
      message: "Orders imported successfully",
    };
  }
  static async getOrders({
    page,
    size,
    vendorName,
    vendorId,
    orderNumber,
    financialStatus,
    status,
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
    if (vendorId) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
          [Op.eq]: vendorId,
        })
      );
    }

    if (status) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("status"), {
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
        {
          model: Customer,
          as: "customer",
          required: true,
        },
      ],
      where: whereClause,
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
    const startOfstartDate = new Date(startDate);
    const endOfEndDate = new Date(endDate);
    startOfstartDate.setHours(0, 0, 0, 0);
    endOfEndDate.setHours(23, 59, 59, 999);

    let whereClause = {
      [Op.and]: [
        sequelize.where(sequelize.col("orderDate"), {
          [Op.gte]: startOfstartDate,
        }),
        sequelize.where(sequelize.col("orderDate"), {
          [Op.lte]: endOfEndDate,
        }),
      ],
    };

    if (vendorId) {
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
    for (const order of orders) {
      totalCost += +order.totalCost;
      totalRevenue += +order.totalPrice;
      totalDiscount += +order.totalDiscounts;
      totalCommission += +order.commission;
      totalTax += +order.totalTax;
    }
    totalProfit =
      totalRevenue - totalCost - totalDiscount - totalCommission - totalTax;
    return {
      status: true,
      statusCode: 200,
      data: {
        totalTax,
        totalCost,
        totalRevenue,
        totalDiscount,
        totalProfit,
        totalCommission,
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
  static async createOrder(orderData) {
    const productsMap = await ProductsService.getProductsMappedByShopifyIds(
      orderData.line_items.map((line) => line.product_id.toString())
    );
    const customersIdsMap =
      await CustomerService.getCustomersMappedByShopifyIds([
        orderData.customer,
      ]);
    let totalCost = 0;
    orderData.line_items.forEach((line) => {
      const discount_allocations = line.discount_allocations || [];
      const lineDiscount = discount_allocations.reduce(
        (acc, item) => acc + Number(item.amount),
        0
      );
      line.discount = lineDiscount;
      const product = productsMap[line.product_id];
      const variant = product.variants
        ? product.variants.find(
            (variant) =>
              variant.shopifyId.toString() === line.variant_id.toString()
          )
        : null;
      const cost = variant ? variant.cost || 0 : 0;
      line.unitCost = cost;
      line.cost = cost * line.quantity;
      totalCost += line.cost;
    });

    const order = await Order.create({
      shopifyId: String(orderData.id),
      name: orderData.name,
      number: orderData.number,
      orderNumber: orderData.order_number,
      subTotalPrice: orderData.subtotal_price,
      totalPrice: orderData.total_price,
      totalDiscounts: orderData.total_discounts,
      orderDate: orderData.created_at,
      customerId: customersIdsMap[orderData.customer.id.toString()],
      totalCost,
    });
    const orderLines = [];

    for (const line of orderData.line_items) {
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
    await OrderLine.bulkCreate(orderLines);
    return {
      status: true,
      statusCode: 201,
      data: order,
    };
  }
}
module.exports = OrderService;
