import express from "express";
import path from "path";
import request from "supertest";

import { loadModuleWithMocks } from "../test-utils/load-module-with-mocks";

const ROOT = process.cwd();
const PRODUCT_ROUTES_PATH = path.join(ROOT, "app/modules/product/product.routes.ts");

const currentUser: { value: Record<string, unknown> } = { value: { id: 1, userType: "1" } };
const controller = {
  createProduct: jest.fn(), createSystemProduct: jest.fn(), duplicateProduct: jest.fn(), getProduct: jest.fn(),
  getProducts: jest.fn(), getProductsTypes: jest.fn(), importProducts: jest.fn(),
  uploadProductImage: jest.fn(async (req: express.Request, res: express.Response) => {
    const uploaded = (req as express.Request & { uploadedImage?: { extension: string; buffer: Buffer } }).uploadedImage;
    res.status(201).json({ data: { extension: uploaded?.extension, size: uploaded?.buffer.length }, status: true });
  }),
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
  app.use("/products", router);
  app.use((error: { code?: string; message?: string; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? 500).json({ code: error.code, message: error.message, status: false });
  });
  return app;
};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const attachImage = (req: request.Test, buffer: Buffer, filename: string, contentType: string) => req.attach("image", buffer, { contentType, filename });

beforeEach(() => {
  jest.clearAllMocks();
  currentUser.value = { id: 1, userType: "1" };
});

describe("POST /products/image", () => {
  it("accepts a real PNG from an admin and derives the extension from the bytes", async () => {
    const response = await attachImage(request(buildApp()).post("/products/image"), PNG, "../../evil name.PNG", "image/png");
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ extension: ".png" });
  });

  it("lets staff holding products_edit upload", async () => {
    currentUser.value = { id: 2, userType: "3", permissions: { products_edit: true } };
    expect((await attachImage(request(buildApp()).post("/products/image"), PNG, "a.png", "image/png")).status).toBe(201);
  });

  it("400s when no file is sent", async () => {
    const response = await request(buildApp()).post("/products/image");
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("اختر صورة للرفع");
    expect(controller.uploadProductImage).not.toHaveBeenCalled();
  });

  it.each([
    ["pdf", "a.pdf", "application/pdf"],
    ["svg", "a.svg", "image/svg+xml"],
    ["heic", "a.heic", "image/heic"],
    ["exe", "a.exe", "application/octet-stream"],
  ])("400s %s with an Arabic message", async (_label, name, type) => {
    const response = await attachImage(request(buildApp()).post("/products/image"), PNG, name, type);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "INVALID_FILE_TYPE", message: "الملف لازم يكون صورة (JPG/PNG/WEBP/GIF)" });
  });

  it("400s a file whose bytes are not an image even with an image name and mime type", async () => {
    const response = await attachImage(request(buildApp()).post("/products/image"), Buffer.from("<script>alert(1)</script>"), "a.png", "image/png");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_FILE_TYPE");
    expect(controller.uploadProductImage).not.toHaveBeenCalled();
  });

  it("413s an image over 5MB", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const response = await attachImage(request(buildApp()).post("/products/image"), big, "big.png", "image/png");
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: "LIMIT_FILE_SIZE", message: "حجم الصورة أكبر من 5 ميجا" });
  });

  it("403s a vendor even with products_edit, and staff without it, before reading the file", async () => {
    currentUser.value = { id: 5, userType: "2", vendorId: 4, permissions: { products_edit: true } };
    expect((await attachImage(request(buildApp()).post("/products/image"), PNG, "a.png", "image/png")).status).toBe(403);
    currentUser.value = { id: 2, userType: "3", permissions: { products_view: true } };
    expect((await attachImage(request(buildApp()).post("/products/image"), PNG, "a.png", "image/png")).status).toBe(403);
    expect(controller.uploadProductImage).not.toHaveBeenCalled();
  });
});
