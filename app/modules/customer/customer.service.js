const ShopifyHelper = require("../helpers/shopifyHelper");
const Customer = require("./customer.model");

class CustomerService {
  static async saveCustomers(customers) {
    const existingCustomers = await Customer.findAll({
      where: {
        shopifyId: customers.map((customer) => String(customer.id)),
      },
      attributes: ["shopifyId"],
    });
    const existingShopifyIds = new Set();
    for (const customer of existingCustomers) {
      existingShopifyIds.add(customer.shopifyId);
    }
    customers = customers
      .filter((customer) => !existingShopifyIds.has(String(customer.id)))
      .map((customer) => {
        return {
          shopifyId: String(customer.id),
          firstName: customer.default_address.first_name,
          lastName: customer.default_address.last_name,
          email: customer.email,
          phone: customer.phone,
          address: customer.default_address.address1,
          address2: customer.default_address.address2,
        };
      });
    if (customers.length === 0) {
      return [];
    }
    const result = await Customer.bulkCreate(customers);
    return result;
  }
}
module.exports = CustomerService;
