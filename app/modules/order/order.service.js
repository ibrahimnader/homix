const ShopifyHelper = require("../helpers/shopifyHelper");

class OrderService {
  static async importOrders() {
    const fields = [];
    const orders = await ShopifyHelper.importData("orders", fields);

    console.log(11);
  }
}
module.exports = OrderService;
