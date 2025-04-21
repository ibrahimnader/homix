const express = require("express");
const mainRouter = express.Router({ mergeParams: true });
const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Homix API",
      version: "1.0.0",
      description: "API documentation for Homix application",
    },
    servers: [
      {
        url: process.env.APP_URL || "http://localhost:3000",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./app/modules/*/*.routes.js"], // Path to route files
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
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
const isNotVendor = require("../app/middlewares/isNotVendor");
const CategoriesRouter = require("../app/modules/product/categories.routes");
const ShipmentRouter = require("../app/modules/shipments/shipment.routes");

// Swagger UI route
mainRouter.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /orders:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Orders
 *     summary: Get all orders
 *     responses:
 *       200:
 *         description: List of orders
 */
mainRouter.use("/orders", OrderRouter);

/**
 * @swagger
 * /orderLines:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Order Lines
 *     summary: Get all order lines
 *     responses:
 *       200:
 *         description: List of order lines
 */
mainRouter.use("/orderLines", OrderLineRouter);

/**
 * @swagger
 * /users:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Get all users
 *     responses:
 *       200:
 *         description: List of users
 */
mainRouter.use("/users", UserRouter);

/**
 * @swagger
 * /factories:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Factories
 *     summary: Get all factories
 *     responses:
 *       200:
 *         description: List of factories
 */
mainRouter.use("/factories", verifyToken, isAdmin, FactoryRouter);

/**
 * @swagger
 * /products:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Products
 *     summary: Get all products
 *     responses:
 *       200:
 *         description: List of products
 */
mainRouter.use("/products", ProductsRouter);
/**
 * @swagger
 * /categories:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Categories
 *     summary: Get all categories
 *     responses:
 *       200:
 *         description: List of categories
 */
mainRouter.use("/categories", CategoriesRouter);

/**
 * @swagger
 * /vendors:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Vendors
 *     summary: Get all vendors
 *     responses:
 *       200:
 *         description: List of vendors
 */
mainRouter.use("/vendors", verifyToken, VendorRouter);

/**
 * @swagger
 * /employees:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Employees
 *     summary: Get all employees
 *     responses:
 *       200:
 *         description: List of employees
 */
mainRouter.use("/employees", verifyToken, isNotVendor, EmployeeRouter);

/**
 * @swagger
 * /customers:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Customers
 *     summary: Get all customers
 *     responses:
 *       200:
 *         description: List of customers
 */
mainRouter.use("/customers", verifyToken, isNotVendor, CustomerRouter);

mainRouter.use("/shipments", verifyToken, isNotVendor, ShipmentRouter);

module.exports = mainRouter;
