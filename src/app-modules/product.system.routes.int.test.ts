import express from "express";
import request from "supertest";
import path from "path";

import { loadModuleWithMocks } from "../test-utils/load-module-with-mocks";

const ROOT = process.cwd();
const PRODUCT_ROUTES_PATH = path.join(ROOT, "app/modules/product/product.routes.ts");

const currentUser: { value: Record<string, unknown> } = { value: { id: 1, userType: "1" } };
const controller = {
  createSystemProduct: jest.fn(async (_req: express.Request, res: express.Response) => { res.status(201).json({ status: true, statusCode: 201 }); }),
  duplicateProduct: jest.fn(async (_req: express.Request, res: express.Response) => { res.status(201).json({ status: true, statusCode: 201 }); }),
  getProduct: jest.fn(), getProducts: jest.fn(), getProductsTypes: jest.fn(), importProducts: jest.fn(), createProduct: jest.fn(),
};

const buildApp = () => {
  const router = loadModuleWithMocks<express.Router>(PRODUCT_ROUTES_PATH, {
    "../../middlewares/protectApi": (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.user = currentUser.value as never;
      next();
    },
    "./product.controller": controller,
    "./product.webhook": { handleShopifyProductWebhook: jest.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use("/products", router);
  /* The router is loaded in an isolated module registry, so its error classes are not ours:
     map by shape (statusCode / ZodError) instead of instanceof. */
  app.use((error: { name?: string; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? (error.name === "ZodError" ? 400 : 500)).json({ status: false });
  });
  return app;
};

const body = { title: "منتج", vendorId: 4, variants: [{ price: 100 }] };

beforeEach(() => {
  jest.clearAllMocks();
  currentUser.value = { id: 1, userType: "1" };
});

describe("POST /products/system", () => {
  it("lets an admin create", async () => {
    const response = await request(buildApp()).post("/products/system").send(body);
    expect(response.status).toBe(201);
    expect(controller.createSystemProduct).toHaveBeenCalled();
  });

  it("lets a staff user holding products_edit create", async () => {
    currentUser.value = { id: 2, userType: "3", permissions: { products_edit: true } };
    expect((await request(buildApp()).post("/products/system").send(body)).status).toBe(201);
  });

  it("403s staff without products_edit", async () => {
    currentUser.value = { id: 2, userType: "3", permissions: { products_view: true } };
    const response = await request(buildApp()).post("/products/system").send(body);
    expect(response.status).toBe(403);
    expect(controller.createSystemProduct).not.toHaveBeenCalled();
  });

  it("403s a vendor even if they hold products_edit", async () => {
    currentUser.value = { id: 5, userType: "2", vendorId: 4, permissions: { products_edit: true } };
    const response = await request(buildApp()).post("/products/system").send(body);
    expect(response.status).toBe(403);
    expect(controller.createSystemProduct).not.toHaveBeenCalled();
  });

  it("400s an invalid body", async () => {
    const response = await request(buildApp()).post("/products/system").send({ title: "", vendorId: 4, variants: [] });
    expect(response.status).toBe(400);
    expect(controller.createSystemProduct).not.toHaveBeenCalled();
  });
});

describe("POST /products/:id/duplicate", () => {
  it("lets an admin duplicate with an empty body", async () => {
    const response = await request(buildApp()).post("/products/12/duplicate").send({});
    expect(response.status).toBe(201);
    expect(controller.duplicateProduct).toHaveBeenCalled();
  });

  it("403s a vendor and staff without products_edit", async () => {
    currentUser.value = { id: 5, userType: "2", vendorId: 4, permissions: { products_edit: true } };
    expect((await request(buildApp()).post("/products/12/duplicate").send({})).status).toBe(403);
    currentUser.value = { id: 2, userType: "3", permissions: {} };
    expect((await request(buildApp()).post("/products/12/duplicate").send({})).status).toBe(403);
    expect(controller.duplicateProduct).not.toHaveBeenCalled();
  });

  it("400s a non-numeric id", async () => {
    expect((await request(buildApp()).post("/products/abc/duplicate").send({})).status).toBe(400);
  });
});
