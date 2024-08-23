require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mainRouter = require("./config/routes");
const { NotFoundError } = require("./app/middlewares/errors");
const globalErrorHandler = require("./app/middlewares/errorhandler");
const fileUpload = require("express-fileupload");
require("./config/shopify");
const ShopifyHelper = require("./app/modules/helpers/shopifyHelper");
global.express = express;
const app = express();
const GB4 = 4 * 1024 * 1024;
const { connectToDb } = require("./config/db.config");
const createDefaultUser = require("./app/modules/user/user.seeder");

const startServer = async () => {
  try {
    await connectToDb();
    app.use(
      fileUpload({
        limits: { fileSize: GB4 },
      })
    );

    global.app = app;

    app.use(bodyParser.json({ limit: "1mb" }));
    app.use(bodyParser.urlencoded({ limit: "1mb", extended: true }));

    /*
     * use cors to enable cross origin requests.
     * this was done because api calls via angular 2 gets blocked.
     */
    app.use(cors());

    app.use((error, req, res, next) => {
      if (error instanceof SyntaxError) {
        return res.status(400).json({
          status: "failed",
          message: "Enter a valid JSON object.",
        });
      }
      res.header(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate"
      );
      res.header("Expires", "-1");
      res.header("Pragma", "no-cache");

      return next();
    });

    app.disable("etag");
    //set the port
    const defaultPort = 4000;
    let port = defaultPort;

    if (process.env.NODE_PORT && parseInt(process.env.NODE_PORT, 10)) {
      port = parseInt(process.env.NODE_PORT, 10);
    }

    app.use("/", mainRouter);
    // Handle 404 errors
    app.all("*", (req, res, next) => {
      next(new NotFoundError(`Can't find ${req.originalUrl} on this server!`));
    });

    // Global error handling middleware
    app.use(globalErrorHandler);

    app.listen(port, async () => {
      console.log(`running at port ${port}`);
      await ShopifyHelper.createWebhooks();
      console.log("Webhooks created successfully");
      await createDefaultUser();
      console.log("Default user created successfully");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
  }
};

startServer();

module.exports = app;
