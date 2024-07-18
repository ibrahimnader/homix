const { Op } = require("sequelize");
const CustomerService = require("../customer/customer.service");
const ShopifyHelper = require("../helpers/shopifyHelper");
const OrderLine = require("../orderLines/orderline.model");
const Product = require("../product/product.model");
const ProductsService = require("../product/product.service");
const Order = require("./order.model");
const { sequelize } = require("../../../config/db.config");

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
        productsIds.add(product.product_id);
      }
    }
    const productsIdsMap = await ProductsService.getProductsMappedByShopifyIds([
      ...productsIds,
    ]);

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
    const customers = [];
    orders = orders
      .filter((order) => !existingShopifyIds.has(String(order.id)))
      .map((order) => {
        lines.push({
          order_id: order.id,
          line_items: order.line_items,
        });
        customers.push(order.customer);
        return {
          shopifyId: String(order.id),
          name: order.name,
          number: order.number,
          orderNumber: order.order_number,
          subTotalPrice: order.subtotal_price,
          totalPrice: order.total_price,
          totalDiscounts: order.total_discounts,
          orderDate: order.created_at,
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
          discount: line.total_discount,
        });
      }
    }
    await OrderLine.bulkCreate(orderLines);
    await CustomerService.saveCustomers(customers);
    return {
      status: true,
      statusCode: 200,
      message: "Orders imported successfully",
    };
  }
  static async getOrders(page = 1, size = 50, searchQuery = "") {
    const orders = await Order.findAndCountAll({
      include: [
        {
          model: OrderLine,
          as: "lines",
          required: false,
        },
      ],
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn("lower", sequelize.col("order.name")), {
            [Op.like]: `%${searchQuery.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("number")), {
            [Op.like]: `%${searchQuery.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("orderNumber")), {
            [Op.like]: `%${searchQuery.toLowerCase()}%`,
          }),
          sequelize.where(
            sequelize.literal(`EXISTS (SELECT 1 FROM \`OrderLines\` AS \`lines\` WHERE \`lines\`.\`OrderId\` = \`Order\`.\`id\` AND \`lines\`.\`title\` LIKE '%${searchQuery.toLowerCase()}%')`),
            true
          ),
        ],
      },

      limit: Number(size),
      offset: (page - 1) * Number(size),
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
}
module.exports = OrderService;
