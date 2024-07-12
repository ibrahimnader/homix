const express = require("express");
const CustomerController = require("./customer.controller");
const CustomerRouter = express.Router();

CustomerRouter.post("/import", CustomerController.importCustomers);

module.exports = CustomerRouter;
