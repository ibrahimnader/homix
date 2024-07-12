
const express = require("express");
const FactoryRouter = express.Router();

const FactoryController = require("./factory.controller");


FactoryRouter.get("/", FactoryController.getAll);
FactoryRouter.get("/:id", FactoryController.getOne);
FactoryRouter.post("/", FactoryController.create);
FactoryRouter.put("/:id", FactoryController.update);
FactoryRouter.delete("/:id", FactoryController.delete);


module.exports = FactoryRouter;
