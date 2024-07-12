const express = require("express");
const OrderService = require("./order.service");
const OrderRouter = express.Router();

OrderRouter.post("/import", OrderService.importOrders);

module.exports = OrderRouter;
