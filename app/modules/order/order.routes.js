const express = require("express");
const OrderController = require("./order.controller");
const verifyToken = require("../../middlewares/protectApi");
const IsNotLogistic = require("../../middlewares/IsNotLogistic");
const OrderRouter = express.Router();

OrderRouter.post("/", OrderController.createOrder);
OrderRouter.get(
  "/financialReport",
  verifyToken,
  IsNotLogistic,
  OrderController.financialReport
);
OrderRouter.get("/", verifyToken, IsNotLogistic, OrderController.getOrders);
OrderRouter.get(
  "/:orderId",
  verifyToken,
  IsNotLogistic,
  OrderController.getOneOrder
);
OrderRouter.put(
  "/:orderId",
  verifyToken,
  IsNotLogistic,
  OrderController.updateOrder
);
OrderRouter.post(
  "/import",
  verifyToken,
  IsNotLogistic,
  OrderController.importOrders
);

module.exports = OrderRouter;
