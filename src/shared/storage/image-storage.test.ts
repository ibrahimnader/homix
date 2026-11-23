import fs from "fs";
import os from "os";
import path from "path";

import { sniffImageType } from "../http/image-upload";

const mockUploads = path.join(os.tmpdir(), `homix-image-storage-test-${process.pid}`);
jest.mock("../../config/env", () => ({ env: { APP_URL: "https://api.example.com/", UPLOADS_DIR: mockUploads } }));
// eslint-disable-next-line import/first
import { createDiskImageStorage } from "./image-storage";

afterAll(() => fs.rmSync(mockUploads, { force: true, recursive: true }));

describe("disk image storage", () => {
  const storage = createDiskImageStorage();

  it("writes a random-named file under the folder and returns an absolute URL", async () => {
    const { url } = await storage.save({ buffer: Buffer.from("x"), extension: ".png", folder: "products" });
    expect(url).toMatch(/^https:\/\/api\.example\.com\/uploads\/products\/[0-9a-f-]{36}\.png$/);
    expect(fs.existsSync(path.join(mockUploads, "products", path.basename(url)))).toBe(true);
    const second = await storage.save({ buffer: Buffer.from("x"), extension: ".png", folder: "products" });
    expect(second.url).not.toBe(url);
  });

  it.each([
    [{ extension: ".png", folder: "../etc" }],
    [{ extension: "/../x.png", folder: "products" }],
    [{ extension: ".svg", folder: "products" }],
    [{ extension: ".php", folder: "products" }],
  ])("refuses an unsafe target %j", async (target) => {
    await expect(storage.save({ buffer: Buffer.from("x"), ...target })).rejects.toThrow("Unsafe image storage target");
  });
});

describe("sniffImageType", () => {
  it("recognises the four allowed types by magic bytes", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe(".jpg");
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(".png");
    expect(sniffImageType(Buffer.from("GIF89a....", "latin1"))).toBe(".gif");
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe(".webp");
  });
  it("rejects everything else", () => {
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});
