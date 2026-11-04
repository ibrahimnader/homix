import bodyParser from "body-parser";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import path from "node:path";

import { env } from "./config/env";
import { createMainRouter } from "./modules/app-router";
import { notifyNavigationCountsChanged } from "./modules/navigation";
import { errorMiddleware, notFoundHandler, requestContextMiddleware } from "./shared/http";
import { httpLogger } from "./shared/logger/http-logger";

const JSON_ERROR_CODE = 400;
const JSON_LIMIT = "1mb";
const URL_ENCODED_LIMIT = "16mb";
const UPLOADS_ROUTE = "/uploads";

const applyCacheHeaders = (_request: Request, response: Response, next: NextFunction): void => {
  response.header("Cache-Control", "private, no-cache, no-store, must-revalidate");
  response.header("Expires", "-1");
  response.header("Pragma", "no-cache");
  next();
};

const handleJsonSyntaxError = (
  error: Error,
  _request: Request,
  response: Response,
  next: NextFunction,
): void => {
  if (error instanceof SyntaxError) {
    response.status(JSON_ERROR_CODE).json({
      message: "Enter a valid JSON object.",
      status: false,
    });
    return;
  }

  next(error);
};

export const createApp = (): Express => {
  const app = express();

  app.disable("etag");
  app.set("query parser", "extended");
  app.use(requestContextMiddleware);
  app.use(httpLogger);
  /* Shopify signs the raw request body, so keep a copy before it is parsed —
     re-serialising the parsed object does not reproduce the original bytes and
     the HMAC would never match. Only the webhook route reads this. */
  app.use(bodyParser.json({
    limit: JSON_LIMIT,
    verify: (request, _response, buffer) => {
      (request as express.Request & { rawBody?: Buffer }).rawBody = buffer;
    },
  }));
  app.use(bodyParser.urlencoded({ extended: true, limit: URL_ENCODED_LIMIT }));
  app.use(cors());
  /* Transfer receipts are vendor-financial documents: served only through the
     authenticated /financial-invoices/:id/receipt endpoint, never as a static file. */
  app.use(`${UPLOADS_ROUTE}/financial-receipts`, (_request, response) => {
    response.status(404).json({ status: false, message: "Not found" });
  });
  app.use(UPLOADS_ROUTE, express.static(path.resolve(env.UPLOADS_DIR)));
  app.use(applyCacheHeaders);
  app.use(notifyNavigationCountsChanged);
  app.use(createMainRouter());
  app.use(notFoundHandler);
  app.use(handleJsonSyntaxError);
  app.use(errorMiddleware);

  return app;
};
