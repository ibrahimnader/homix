const CustomerService = require("./customer.service");

class CustomerController {


  static async importCustomers(req, res) {
    const order = await CustomerService.importCustomers(req.body);
    res.status(201).json(order);
  }
}
module.exports = CustomerController;