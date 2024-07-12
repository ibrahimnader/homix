const express = require("express");
const UserRouter = require("../app/modules/user/user.routes");
const FactoryRouter = require("../app/modules/factory/factory.routes");
const OrderRouter = require("../app/modules/order/order.routes");
const ProductsRouter = require("../app/modules/product/product.routes");
const VendorRouter = require("../app/modules/vendor/vendor.routes");
const EmployeeRouter = require("../app/modules/employee/employee.routes");
const CustomerRouter = require("../app/modules/customer/customer.routes");
const mainRouter = express.Router({ mergeParams: true });

mainRouter.use("/users", UserRouter);
mainRouter.use("/factories", FactoryRouter);
mainRouter.use("/orders", OrderRouter);
mainRouter.use("/products", ProductsRouter);
mainRouter.use("/vendors", VendorRouter);
mainRouter.use("/employees", EmployeeRouter);
mainRouter.use("/customers", CustomerRouter);

module.exports = mainRouter;
