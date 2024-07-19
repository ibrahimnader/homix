const express = require("express");
const AuthController = require("./AuthController");
const UserController = require("./user.controller");
const verifyToken = require("../../middlewares/protectApi");
const isAdmin = require("../../middlewares/isAdmin");
const UserRouter = express.Router();

UserRouter.get("/", verifyToken, isAdmin, UserController.getAllUsers);
UserRouter.get("/:id", verifyToken, isAdmin, UserController.getUser);
UserRouter.put("/:id", verifyToken, isAdmin, UserController.editUser);
UserRouter.post("/login", AuthController.login);
UserRouter.post("/", verifyToken, isAdmin, AuthController.addUser);

module.exports = UserRouter;
