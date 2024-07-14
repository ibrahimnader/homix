const express = require("express");
const AuthController = require("./AuthController");
const UserController = require("./user.controller");
const UserRouter = express.Router();

UserRouter.get("/", UserController.getAllUsers);
UserRouter.get("/:id", UserController.getUser);
UserRouter.put("/:id", UserController.editUser);
UserRouter.post("/login", AuthController.login);
UserRouter.post("/", AuthController.addUser);

module.exports = UserRouter;
