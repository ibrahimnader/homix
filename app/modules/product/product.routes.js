const express = require("express");
const productsController = require("./product.controller");
const verifyToken = require("../../middlewares/protectApi");
const ProductsRouter = express.Router();

ProductsRouter.post("/", productsController.createProduct);
ProductsRouter.get("/", verifyToken, productsController.getProducts);
ProductsRouter.get("/:id", verifyToken, productsController.getProduct);
ProductsRouter.post("/import", verifyToken, productsController.importProducts);

module.exports = ProductsRouter;
