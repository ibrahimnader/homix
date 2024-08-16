const express = require("express");
const verifyToken = require("../../middlewares/protectApi");
const OrderLineController = require("./orderLine.controller");
const OrderLineRouter = express.Router();


OrderLineRouter.put("/:orderLineId", verifyToken, OrderLineController.updateOrderLine);
OrderLineRouter.put("/:orderLineId/notes/:noteId", verifyToken, OrderLineController.updateNote);
OrderLineRouter.post("/:orderLineId/notes", verifyToken, OrderLineController.addNote);
OrderLineRouter.delete("/:orderLineId/notes/:noteId", verifyToken, OrderLineController.deleteNote);

module.exports = OrderLineRouter;
