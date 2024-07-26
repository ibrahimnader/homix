const express = require("express");
const OrderController = require("./order.controller");
const OrderRouter = express.Router();

OrderRouter.get("/", OrderController.getOrders);
OrderRouter.get("/:orderId", OrderController.getOneOrder);
OrderRouter.post("/import", OrderController.importOrders);

module.exports = OrderRouter;
