import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

const mockUploads = path.join(os.tmpdir(), `homix-upload-test-${process.pid}`);
jest.mock("../../config/env", () => ({ env: { UPLOADS_DIR: mockUploads } }));
// eslint-disable-next-line import/first
const fileUploadMiddleware = require("../../../config/fileUploadMiddleware");

const app = express();
app.post("/upload", fileUploadMiddleware("financial-receipts"), (req, res) => {
  res.json({ names: (req as never as { fileNames: string[] }).fileNames, paths: (req as never as { filePaths: string[] }).filePaths });
});

afterAll(() => fs.rmSync(mockUploads, { force: true, recursive: true }));

describe("fileUploadMiddleware", () => {
  test.each([
    ["jpeg", "receipt.jpeg", "image/jpeg"],
    ["jpg", "receipt.JPG", "image/jpeg"],
    ["png", "receipt.png", "image/png"],
    ["gif", "receipt.gif", "image/gif"],
    ["pdf", "receipt.pdf", "application/pdf"],
  ])("accepts %s and stores it under a unique name", async (_label, name, contentType) => {
    const res = await request(app).post("/upload").attach("files", Buffer.from("data"), { contentType, filename: name });
    expect(res.status).toBe(200);
    expect(res.body.paths).toHaveLength(1);
    expect(res.body.paths[0]).toMatch(/^uploads\/financial-receipts\//);
    expect(fs.existsSync(path.join(mockUploads, "financial-receipts", path.basename(res.body.paths[0])))).toBe(true);
  });

  test.each([
    ["webp", "r.webp", "image/webp"],
    ["heic", "r.heic", "image/heic"],
    ["extension/mimetype mismatch", "r.pdf", "text/plain"],
    ["exe", "r.exe", "application/octet-stream"],
  ])("rejects %s with 400 and an Arabic JSON message", async (_label, name, contentType) => {
    const res = await request(app).post("/upload").attach("files", Buffer.from("data"), { contentType, filename: name });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "INVALID_FILE_TYPE", message: "الملف لازم يكون صورة (JPG/PNG/GIF) أو PDF", status: false });
  });

  test("rejects a 17MB file with 413", async () => {
    const res = await request(app).post("/upload").attach("files", Buffer.alloc(17 * 1024 * 1024), { contentType: "application/pdf", filename: "big.pdf" });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: "LIMIT_FILE_SIZE", message: "حجم الملف أكبر من 16 ميجا", status: false });
  });

  test("no file: continues with empty arrays (callers answer 400 themselves)", async () => {
    const res = await request(app).post("/upload").field("x", "1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ names: [], paths: [] });
  });

  test("a save failure answers 500 JSON and logs the real error", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const blocker = path.join(mockUploads, "blocked");
    fs.mkdirSync(mockUploads, { recursive: true });
    fs.writeFileSync(blocker, "file, not a directory");
    const blockedApp = express();
    blockedApp.post("/upload", fileUploadMiddleware("blocked/sub"), (_req, res) => res.json({}));
    const res = await request(blockedApp).post("/upload").attach("files", Buffer.from("x"), { contentType: "application/pdf", filename: "a.pdf" });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "SAVE_FAILED", message: "تعذر حفظ الملف على الخادم", status: false });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
