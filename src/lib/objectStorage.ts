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
 * Until a real provider is configured, all operations fail with 503.
 */
export interface ObjectStorage {
  isConfigured(): boolean;
  createUploadUrl(req: UploadUrlRequest): Promise<SignedUrlResult>;
  createViewUrl(objectKey: string): Promise<SignedUrlResult>;
  headObject(objectKey: string): Promise<{ contentType: string; byteSize: number; checksum?: string }>;
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

export const objectStorage: ObjectStorage = new UnconfiguredObjectStorage();

/** Helper used by routes before calling storage. */
export const assertStorageConfigured = (): void => {
  if (!objectStorage.isConfigured() || !env.OBJECT_STORAGE_CONFIGURED) {
    fail(503, "Object storage is not configured");
  }
};
