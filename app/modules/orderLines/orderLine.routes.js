const express = require("express");
const verifyToken = require("../../middlewares/protectApi");
const OrderLineController = require("./orderLine.controller");
const IsNotLogistic = require("../../middlewares/isNotLogistic");
const isAdmin = require("../../middlewares/isAdmin");
const OrderLineRouter = express.Router();

OrderLineRouter.put(
  "/:orderLineId",
  verifyToken,
  IsNotLogistic,
  OrderLineController.updateOrderLine
);
OrderLineRouter.put(
  "/:orderLineId/notes/:noteId",
  verifyToken,
  isAdmin,
  OrderLineController.updateNote
);
OrderLineRouter.post(
  "/:orderLineId/notes",
  verifyToken,
  IsNotLogistic,
  OrderLineController.addNote
);
OrderLineRouter.delete(
  "/:orderLineId/notes/:noteId",
  verifyToken,
  isAdmin,
  OrderLineController.deleteNote
);

module.exports = OrderLineRouter;
