const express = require("express");
const OrderController = require("./order.controller");
const OrderRouter = express.Router();

OrderRouter.post("/import", OrderController.importOrders);
OrderRouter.get("/", OrderController.getOrders);

module.exports = OrderRouter;
