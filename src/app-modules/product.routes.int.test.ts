import express from "express";
import request from "supertest";
import path from "path";

import { loadModuleWithMocks } from "../test-utils/load-module-with-mocks";

const ROOT = process.cwd();
const PRODUCT_ROUTES_PATH = path.join(ROOT, "app/modules/product/product.routes.ts");
const CATEGORY_ROUTES_PATH = path.join(ROOT, "app/modules/product/categories.routes.ts");

describe("product routes", () => {
  it("returns product list", async () => {
    const router = loadModuleWithMocks<express.Router>(PRODUCT_ROUTES_PATH, {
      "../../middlewares/protectApi": (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        req.user = { id: 1, userType: "1" };
        next();
      },
      "./product.controller": {
        createProduct: jest.fn(),
        createSystemProduct: jest.fn(),
        duplicateProduct: jest.fn(),
        getProduct: jest.fn(),
        getProducts: (_req: express.Request, res: express.Response) => {
          res.json({ data: { products: [], totalPages: 0 }, status: true, statusCode: 200 });
        },
        getProductsTypes: jest.fn(),
        importProducts: jest.fn(),
      },
    });

    const app = express();
    app.use("/products", router);

    const response = await request(app).get("/products");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
  });

  it("returns category list", async () => {
    const router = loadModuleWithMocks<express.Router>(CATEGORY_ROUTES_PATH, {
      "../../middlewares/protectApi": (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        req.user = { id: 1, userType: "1" };
        next();
      },
      "./product.controller": {
        getAllCategories: (_req: express.Request, res: express.Response) => {
          res.json({ data: [{ id: 1, title: "Office" }], status: true, statusCode: 200 });
        },
      },
    });

    const app = express();
    app.use("/categories", router);

    const response = await request(app).get("/categories");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 1, title: "Office" }]);
  });
});
