const ShopifyHelper = require("../helpers/shopifyHelper");

class CustomerService {
  static async importCustomers() {
    const fields = [];
    const customers = await ShopifyHelper.importData("customers", fields);

    console.log(11);
  }
}
module.exports = CustomerService;
