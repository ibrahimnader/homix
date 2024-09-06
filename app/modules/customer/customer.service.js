const ShopifyHelper = require("../helpers/shopifyHelper");
const Customer = require("./customer.model");

class CustomerService {
  static async importCustomers(parameters) {
    const fields = [];
    const customers = await ShopifyHelper.importData(
      "customers",
      fields,
      parameters
    );

    const result = await CustomerService.saveImportedCustomers(customers);
    return result;
  }
  static async saveImportedCustomers(customers) {
    const existingCustomers = await Customer.findAll({
      where: {
        shopifyId: customers.map((customer) => String(customer.id)),
      },
      attributes: ["shopifyId"],
    });
    const existingShopifyIds = new Set();
    for (const customer of existingCustomers) {
      existingShopifyIds.add(product.shopifyId);
    }

    customers = customers
      .filter((customer) => !existingShopifyIds.has(String(customer.id)))
      .map((customer) => {
        return {
          shopifyId: String(customer.id),
          firstName: customer.default_address.first_name,
          lastName: customer.default_address.last_name,
          email: customer.email || customer.default_address.email,
          phoneNumber: customer.phone || customer.default_address.phone,
          address: customer.default_address.address1,
          address2: customer.default_address.address2,
        };
      });

    const importData = await Customer.bulkCreate(customers, {
      updateOnDuplicate: ["shopifyId"],
    });
    return {
      status: true,
      message: "Customers imported successfully",
      data: importData,
      statusCode: 200,
    };
  }
  static async getCustomersMappedByShopifyIds(customers) {
    const customersIds = customers.map((customer) => customer.id.toString());
    const customersFromDB = await Customer.findAll({
      where: {
        shopifyId: customersIds,
      },
      attributes: ["shopifyId", "id"],
    });
    const result = {};
    const existingShopifyIds = new Set();
    for (const customer of customersFromDB) {
      result[customer.shopifyId] = customer.id;
      existingShopifyIds.add(customer.shopifyId.toString());
    }
    const nonExistingCustomers = customers.filter(
      (customer) => !existingShopifyIds.has(customer.id.toString())
    );
    if (nonExistingCustomers.length > 0) {
      const res = await CustomerService.saveCustomers(nonExistingCustomers);
      for (const customer of res) {
        result[customer.shopifyId.toString()] = customer.id;
      }
    }
    return result;
  }
  static async saveCustomers(customers) {
    customers = customers.map((customer) => {
      return {
        shopifyId: String(customer.id),
        firstName:
          customer.first_name ||
          customer.default_address.first_name ||
          customer.default_address.name,
        lastName: customer.last_name || customer.default_address.last_name,
        email: customer.email || customer.default_address.email,
        phoneNumber: customer.phone || customer.default_address.phone,
        address: customer.default_address
          ? customer.default_address.address1
          : "",
        address2: customer.default_address
          ? customer.default_address.address2
          : "",
      };
    });
    const result = await Customer.bulkCreate(customers);
    return result.map((customer) => customer.toJSON());
  }
}
module.exports = CustomerService;
