import type { NextFunction, Request, RequestHandler, Response } from "express";

import { AppError } from "../errors";

// multer ships no type declarations in this project (see config/fileUploadMiddleware.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const multer = require("multer") as any;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i;
const ALLOWED_MIME_TYPES = /^image\/(jpeg|jpg|pjpeg|png|x-png|webp|gif)$/i;

export const IMAGE_UPLOAD_MESSAGES = {
  invalidType: "الملف لازم يكون صورة (JPG/PNG/WEBP/GIF)",
  missing: "اختر صورة للرفع",
  tooLarge: "حجم الصورة أكبر من 5 ميجا",
} as const;

export interface UploadedImage {
  buffer: Buffer;
  /** Derived from the sniffed content, never from the client file name. */
  extension: ".jpg" | ".png" | ".webp" | ".gif";
}

/** Detects the real image type from the first bytes; null when it is not one of the allowed types. */
export const sniffImageType = (buffer: Buffer): UploadedImage["extension"] | null => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("latin1"))) return ".gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return ".webp";
  return null;
};

const upload = multer({
  fileFilter: (_request: unknown, file: { originalname: string; mimetype?: string }, callback: (error: Error | null, accept?: boolean) => void) => {
    if (ALLOWED_EXTENSIONS.test(file.originalname) && ALLOWED_MIME_TYPES.test(String(file.mimetype ?? ""))) {
      callback(null, true);
      return;
    }
    callback(new AppError(IMAGE_UPLOAD_MESSAGES.invalidType, 400, "INVALID_FILE_TYPE"));
  },
  limits: { fields: 0, files: 1, fileSize: IMAGE_MAX_BYTES },
  storage: multer.memoryStorage(),
}).single("image");

/**
 * Accepts one multipart field named `image`; answers 400 (missing / wrong type / content is not an
 * image) or 413 (over 5MB) with an Arabic JSON message. Sets `request.uploadedImage` on success.
 */
export const productImageUpload: RequestHandler = (request: Request, response: Response, next: NextFunction) => {
  upload(request, response, (error: unknown) => {
    if (error instanceof AppError) return next(error);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "LIMIT_FILE_SIZE") return next(new AppError(IMAGE_UPLOAD_MESSAGES.tooLarge, 413, "LIMIT_FILE_SIZE"));
      if (code === "LIMIT_UNEXPECTED_FILE" || code === "LIMIT_FIELD_COUNT" || code === "LIMIT_FILE_COUNT") {
        return next(new AppError(IMAGE_UPLOAD_MESSAGES.missing, 400, "INVALID_UPLOAD"));
      }
      return next(error);
    }
    const file = (request as Request & { file?: { buffer: Buffer } }).file;
    if (!file) return next(new AppError(IMAGE_UPLOAD_MESSAGES.missing, 400, "FILE_REQUIRED"));
    const extension = sniffImageType(file.buffer);
    if (!extension) return next(new AppError(IMAGE_UPLOAD_MESSAGES.invalidType, 400, "INVALID_FILE_TYPE"));
    (request as Request & { uploadedImage?: UploadedImage }).uploadedImage = { buffer: file.buffer, extension };
    return next();
  });
};
