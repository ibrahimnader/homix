const express = require("express");
const productsController = require("./product.controller");
const ProductsRouter = express.Router();

ProductsRouter.get("/", productsController.getProducts);
ProductsRouter.get("/:id", productsController.getProduct);
ProductsRouter.post("/import", productsController.importProducts);

module.exports = ProductsRouter;
