const { Op, where } = require("sequelize");
const CustomerService = require("../customer/customer.service");
const ShopifyHelper = require("../helpers/shopifyHelper");
const OrderLine = require("../orderLines/orderline.model");
const Product = require("../product/product.model");
const ProductsService = require("../product/product.service");
const Order = require("./order.model");
const { sequelize } = require("../../../config/db.config");
const Vendor = require("../vendor/vendor.model");
const Customer = require("../customer/customer.model");

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
    const productsIdsMap = await ProductsService.getProductsMappedByShopifyIds([
      ...productsIds,
    ]);
    const customersIdsMap =
      await CustomerService.getCustomersMappedByShopifyIds(
        orders.map((order) => order.customer)
      );
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
      .filter((order) => !existingShopifyIds.has(String(order.id)))
      .map((order) => {
        order.line_items.forEach((line) => {
          const discount_allocations = line.discount_allocations || [];
          const lineDiscount = discount_allocations.reduce(
            (acc, item) => acc + Number(item.amount),
            0
          );
          line.discount = lineDiscount;
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
          subTotalPrice: order.subtotal_price,
          totalPrice: order.total_price,
          totalDiscounts: order.total_discounts,
          orderDate: order.created_at,
          customerId: customersIdsMap[order.customer.id.toString()],
        };
      });

    const result = await Order.bulkCreate(orders);
    const savedOrders = result.map((order) => order.toJSON());
    const orderLines = [];
    for (const { order_id, line_items } of lines) {
      const order = savedOrders.find(
        (order) => order.shopifyId === String(order_id)
      );
      for (const line of line_items) {
        orderLines.push({
          orderId: order.id,
          productId: productsIdsMap[line.product_id],
          shopifyId: String(line.id),
          title: line.title,
          name: line.name,
          price: line.price,
          quantity: line.quantity,
          sku: line.sku,
          variant_id: line.variant_id,
          discount: line.discount,
        });
      }
    }
    await OrderLine.bulkCreate(orderLines);
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
  static async getOneOrder(orderId) {
    const order = await Order.findByPk(orderId, {
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
    });
    return {
      status: true,
      statusCode: 200,
      data: order,
    };
  }
  static async createOrder(orderData) {
    const lines = [];
    const productsIdsMap = await ProductsService.getProductsMappedByShopifyIds([
      ...orderData.orderLines.map((line) => line.productId),
    ]);
    const customersIdsMap =
      await CustomerService.getCustomersMappedByShopifyIds([
        orderData.customer,
      ]);
    order.line_items.forEach((line) => {
      const discount_allocations = line.discount_allocations || [];
      const lineDiscount = discount_allocations.reduce(
        (acc, item) => acc + Number(item.amount),
        0
      );
      line.discount = lineDiscount;
    });
    lines.push(order.line_items);

    const order = await Order.create({
      shopifyId: String(order.id),
      name: order.name,
      number: order.number,
      orderNumber: order.order_number,
      subTotalPrice: order.subtotal_price,
      totalPrice: order.total_price,
      totalDiscounts: order.total_discounts,
      orderDate: order.created_at,
      customerId: customersIdsMap[order.customer.id.toString()],
    });
    const orderLines = [];

    for (const line of lines) {
      orderLines.push({
        orderId: order.id,
        productId: productsIdsMap[line.product_id],
        shopifyId: String(line.id),
        title: line.title,
        name: line.name,
        price: line.price,
        quantity: line.quantity,
        sku: line.sku,
        variant_id: line.variant_id,
        discount: line.discount,
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
