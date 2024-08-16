const express = require("express");
const UserRouter = require("../app/modules/user/user.routes");
const FactoryRouter = require("../app/modules/factory/factory.routes");
const OrderRouter = require("../app/modules/order/order.routes");
const ProductsRouter = require("../app/modules/product/product.routes");
const VendorRouter = require("../app/modules/vendor/vendor.routes");
const EmployeeRouter = require("../app/modules/employee/employee.routes");
const CustomerRouter = require("../app/modules/customer/customer.routes");
const verifyToken = require("../app/middlewares/protectApi");
const isAdmin = require("../app/middlewares/isAdmin");
const OrderLineRouter = require("../app/modules/orderLines/orderLine.routes");
const mainRouter = express.Router({ mergeParams: true });

mainRouter.use("/users", UserRouter);
mainRouter.use("/factories", verifyToken, isAdmin, FactoryRouter);
mainRouter.use("/orders", OrderRouter);
mainRouter.use("/orderLines", OrderLineRouter);
mainRouter.use("/products", ProductsRouter);
mainRouter.use("/vendors", verifyToken, VendorRouter);
mainRouter.use("/employees", verifyToken, isAdmin, EmployeeRouter);
mainRouter.use("/customers", verifyToken, isAdmin, CustomerRouter);

module.exports = mainRouter;
