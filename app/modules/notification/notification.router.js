const express = require("express");
const NotificationRouter = express.Router();
const NotificationController = require("./notification.controller");
const verifyToken = require("../../middlewares/protectApi");

NotificationRouter.get("/",verifyToken, NotificationController.getNotifications);

NotificationRouter.delete(
  "/",
  verifyToken,
  NotificationController.clearNotifications
);

NotificationRouter.put("/", verifyToken, NotificationController.markAsRead);

module.exports = NotificationRouter;
