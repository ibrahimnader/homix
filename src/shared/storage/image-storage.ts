import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env";

/**
 * The ONLY place that knows where uploaded images live. Callers get back a public absolute URL
 * and store that string; swapping to S3/GCS/Cloudinary means replacing `createDiskImageStorage`
 * (or assigning another `ImageStorage` to `imageStorage`) and nothing else.
 *
 * WARNING: the disk driver writes under UPLOADS_DIR. On hosts with an ephemeral filesystem
 * (Render without a persistent disk) those files DISAPPEAR on every redeploy/restart, leaving
 * broken image links. Mount a persistent disk and point UPLOADS_DIR at it, or add a cloud driver.
 */
export interface StoredImage {
  /** Absolute public URL, saved in the product's `image` column. */
  url: string;
}

export interface ImageStorage {
  save(input: { buffer: Buffer; extension: string; folder: string }): Promise<StoredImage>;
}

const SAFE_FOLDER = /^[a-z0-9-]+$/;
const SAFE_EXTENSION = /^\.(jpg|png|webp|gif)$/;

export const createDiskImageStorage = (): ImageStorage => ({
  async save({ buffer, extension, folder }) {
    if (!SAFE_FOLDER.test(folder) || !SAFE_EXTENSION.test(extension)) {
      throw new Error("Unsafe image storage target");
    }
    const directory = path.resolve(env.UPLOADS_DIR, folder);
    await fs.mkdir(directory, { recursive: true });
    const fileName = `${crypto.randomUUID()}${extension}`;
    // "wx": never overwrite an existing file, even on a (practically impossible) name clash.
    await fs.writeFile(path.join(directory, fileName), buffer, { flag: "wx" });
    return { url: `${env.APP_URL.replace(/\/+$/, "")}/uploads/${folder}/${fileName}` };
  },
});

export const imageStorage: ImageStorage = createDiskImageStorage();
