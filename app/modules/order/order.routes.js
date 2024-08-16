const express = require("express");
const OrderController = require("./order.controller");
const verifyToken = require("../../middlewares/protectApi");
const isAdmin = require("../../middlewares/isAdmin");
const OrderRouter = express.Router();

OrderRouter.post("/", OrderController.createOrder);
OrderRouter.get("/financialReport", verifyToken, OrderController.financialReport);
OrderRouter.get("/", verifyToken, OrderController.getOrders);
OrderRouter.get("/:orderId", verifyToken, OrderController.getOneOrder);
OrderRouter.put("/:orderId", verifyToken,isAdmin, OrderController.updateOrder);
OrderRouter.post("/import", verifyToken, OrderController.importOrders);

module.exports = OrderRouter;
