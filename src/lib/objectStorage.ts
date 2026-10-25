import { createHmac, timingSafeEqual } from "crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { fail } from "./errors";
import { env } from "../config/env";

export interface UploadUrlRequest {
  objectKey: string;
  contentType: string;
  byteSize: number;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: Date;
  headers?: Record<string, string>;
}

/**
 * Private object-storage abstraction.
 * Local filesystem driver for development; Cloudflare R2 later.
 */
export interface ObjectStorage {
  isConfigured(): boolean;
  createUploadUrl(req: UploadUrlRequest): Promise<SignedUrlResult>;
  createViewUrl(objectKey: string): Promise<SignedUrlResult>;
  headObject(objectKey: string): Promise<{ contentType: string; byteSize: number; checksum?: string }>;
  /** Local driver: persist bytes after a signed PUT. No-op/throw for remote drivers. */
  putObject?(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  /** Local driver: open a readable stream for a signed GET. */
  openObjectStream?(objectKey: string): Promise<{ stream: Readable; contentType: string; byteSize: number }>;
}

class UnconfiguredObjectStorage implements ObjectStorage {
  isConfigured(): boolean {
    return false;
  }

  async createUploadUrl(_req: UploadUrlRequest): Promise<SignedUrlResult> {
    fail(503, "Object storage is not configured");
  }

  async createViewUrl(_objectKey: string): Promise<SignedUrlResult> {
    fail(503, "Object storage is not configured");
  }

  async headObject(_objectKey: string): Promise<{ contentType: string; byteSize: number; checksum?: string }> {
    fail(503, "Object storage is not configured");
  }
}

type MetaFile = { contentType: string; byteSize: number };

class LocalFilesystemObjectStorage implements ObjectStorage {
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly ttlSec: number;

  constructor(root: string, baseUrl: string, ttlSec: number) {
    this.root = root;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.ttlSec = ttlSec;
    mkdirSync(this.root, { recursive: true });
  }

  isConfigured(): boolean {
    return true;
  }

  private objectPath(objectKey: string): string {
    if (!objectKey || objectKey.includes("..") || objectKey.startsWith("/") || objectKey.includes("\\")) {
      fail(400, "Invalid object key");
    }
    return join(this.root, objectKey);
  }

  private metaPath(objectKey: string): string {
    return `${this.objectPath(objectKey)}.meta.json`;
  }

  private sign(method: "PUT" | "GET", objectKey: string, exp: number): string {
    return createHmac("sha256", env.TOKEN_PEPPER)
      .update(`${method}\n${objectKey}\n${exp}`)
      .digest("hex");
  }

  verifySignature(method: "PUT" | "GET", objectKey: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
      return false;
    }
    const expected = this.sign(method, objectKey, exp);
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(sig, "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private signedUrl(method: "PUT" | "GET", objectKey: string, contentType?: string): SignedUrlResult {
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const sig = this.sign(method, objectKey, exp);
    const url = `${this.baseUrl}/api/storage/objects?key=${encodeURIComponent(objectKey)}&exp=${exp}&sig=${sig}`;
    return {
      url,
      expiresAt,
      headers: contentType ? { "Content-Type": contentType } : undefined,
    };
  }

  async createUploadUrl(req: UploadUrlRequest): Promise<SignedUrlResult> {
    return this.signedUrl("PUT", req.objectKey, req.contentType);
  }

  async createViewUrl(objectKey: string): Promise<SignedUrlResult> {
    return this.signedUrl("GET", objectKey);
  }

  async headObject(objectKey: string): Promise<{ contentType: string; byteSize: number; checksum?: string }> {
    const path = this.objectPath(objectKey);
    const metaFile = this.metaPath(objectKey);
    if (!existsSync(path) || !existsSync(metaFile)) {
      fail(404, "Object not found");
    }
    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as MetaFile;
    const st = statSync(path);
    return { contentType: meta.contentType, byteSize: meta.byteSize || st.size };
  }

  async putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    const path = this.objectPath(objectKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    writeFileSync(this.metaPath(objectKey), JSON.stringify({ contentType, byteSize: body.length } satisfies MetaFile));
  }

  async openObjectStream(
    objectKey: string,
  ): Promise<{ stream: Readable; contentType: string; byteSize: number }> {
    const head = await this.headObject(objectKey);
    return {
      stream: createReadStream(this.objectPath(objectKey)),
      contentType: head.contentType,
      byteSize: head.byteSize,
    };
  }
}

const buildObjectStorage = (): ObjectStorage => {
  if (env.OBJECT_STORAGE_DRIVER === "local") {
    const baseUrl = env.PUBLIC_API_BASE_URL || `http://localhost:${env.PORT}`;
    return new LocalFilesystemObjectStorage(env.LOCAL_STORAGE_ROOT, baseUrl, env.LOCAL_STORAGE_URL_TTL_SEC);
  }
  return new UnconfiguredObjectStorage();
};

export const objectStorage: ObjectStorage = buildObjectStorage();

export const getLocalObjectStorage = (): LocalFilesystemObjectStorage | null => {
  return objectStorage instanceof LocalFilesystemObjectStorage ? objectStorage : null;
};

/** Helper used by routes before calling storage. */
export const assertStorageConfigured = (): void => {
  if (!objectStorage.isConfigured()) {
    fail(503, "Object storage is not configured");
  }
};
