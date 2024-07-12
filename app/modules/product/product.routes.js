const express = require("express");
const productsController = require("./product.controller");
const ProductsRouter = express.Router();

ProductsRouter.get("/", productsController.getProducts);
ProductsRouter.post("/import", productsController.importProducts);

module.exports = ProductsRouter;
