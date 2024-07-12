const shopifyClient = require("../../../config/shopify");

class OrderService {
  static async getOrders() {
    const orders = await shopifyClient.get({ path: "orders" });
    console.log(11);
  }
}
module.exports = OrderService;
