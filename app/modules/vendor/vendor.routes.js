
const express = require("express");
const VendorsController = require("./vendor.controller");
const VendorRouter = express.Router();
VendorRouter.get("/", VendorsController.getVendors);



module.exports = VendorRouter;
