import type { NextFunction, Request, Response } from "express";

const { AppError } = require("../../middlewares/errors") as typeof import("../../middlewares/errors");
const productsService = require("./product.service") as typeof import("./product.service");
const { imageStorage } = require("../../../src/shared/storage/image-storage") as typeof import("../../../src/shared/storage/image-storage");
const { canEditOrderFinancials } = require("../../../src/modules/orders/order-financial-guard") as typeof import("../../../src/modules/orders/order-financial-guard");

const getId = (req: Request): string => {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id ?? "";
};

class ProductsController {
  public static async importProducts(_req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      await productsService.importProducts({}, true);
      return res.status(200).json({
        message: "Products imported successfully",
        status: true,
        statusCode: 200,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import products";
      return next(new AppError(message, 500));
    }
  }

  public static async getProducts(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const { page, size, searchQuery } = req.query as Record<string, string | undefined>;
      const vendorFromToken = req.vendorId;
      const vendors = vendorFromToken
        ? [String(vendorFromToken)]
        : (req.query.vendorsIds as string | undefined)?.split(",") ?? [];
      const categories = (req.query.categoriesIds as string | undefined)?.split(",") ?? [];
      const types = (req.query.typesIds as string | undefined)?.split(",") ?? [];

      const result = await productsService.getProducts(
        page,
        size,
        searchQuery ?? "",
        vendors,
        categories,
        types,
      );
      return res.status(result.statusCode).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch products";
      return next(new AppError(message, 500));
    }
  }

  public static async getProductsTypes(_req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const result = await productsService.getProductsTypes();
      return res.status(result.statusCode).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch product types";
      return next(new AppError(message, 500));
    }
  }

  public static async getAllCategories(_req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const result = await productsService.getAllCategories();
      return res.status(result.statusCode).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch categories";
      return next(new AppError(message, 500));
    }
  }

  public static async getProduct(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const result = await productsService.getOneProduct(getId(req));
      return res.status(result.statusCode).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch product";
      return next(new AppError(message, 500));
    }
  }

  /** POST /products/image — stores one product image and returns its public URL (the product's `image` value). */
  public static async uploadProductImage(req: Request, res: Response): Promise<Response> {
    const uploaded = (req as Request & { uploadedImage?: { buffer: Buffer; extension: string } }).uploadedImage;
    if (!uploaded) return res.status(400).json({ message: "اختر صورة للرفع", status: false });
    const { url } = await imageStorage.save({ buffer: uploaded.buffer, extension: uploaded.extension, folder: "products" });
    return res.status(201).json({ data: { url }, message: "تم رفع الصورة", status: true, statusCode: 201 });
  }

  /** POST /products/system — brand-new product created inside the system. */
  public static async createSystemProduct(req: Request, res: Response): Promise<Response> {
    const result = await productsService.createSystemProduct(req.body, {
      canEditFinancials: canEditOrderFinancials(req.user),
    });
    return res.status(result.statusCode).json(result);
  }

  /** POST /products/:id/duplicate — copy a product into a new system product, with edits. */
  public static async duplicateProduct(req: Request, res: Response): Promise<Response> {
    const result = await productsService.duplicateProduct(Number(getId(req)), req.body, {
      canEditFinancials: canEditOrderFinancials(req.user),
    });
    return res.status(result.statusCode).json(result);
  }

  public static async createProduct(req: Request, res: Response): Promise<Response> {
    try {
      await productsService.saveImportedProducts([req.body]);
      return res.status(200).json({
        message: "Product created successfully",
        status: true,
        statusCode: 200,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create product";
      return res.status(200).json({
        message: `prod Webhook received With Error",${message}`,
        status: false,
      });
    }
  }
}

export = ProductsController;
