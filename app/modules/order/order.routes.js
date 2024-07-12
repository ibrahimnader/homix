const express = require("express");
const OrderService = require("./order.service");
const OrderRouter = express.Router();

OrderRouter.post("/", OrderService.getOrders);

module.exports = OrderRouter;
