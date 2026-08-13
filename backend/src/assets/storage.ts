/**
 * Asset storage abstraction — mandatory per spec section 23.1.
 *
 * Business services never touch the filesystem directly and never see an
 * absolute path. `assets.storage_path` is an opaque storage key, so swapping
 * this local implementation for S3/MinIO/Azure later is a new adapter rather
 * than a rewrite of the campaign and activation services.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '../config/env';

export interface StoredAsset {
  /** Opaque storage key, e.g. `2026/08/3f2b....jpg`. Never an absolute path. */
  storageKey: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
}

export interface AssetStorage {
  /** Moves an already-staged temporary file into permanent storage. */
  publish(temporaryPath: string, storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  /** URL the frontend can load. Not the storage key. */
  publicUrl(storageKey: string): string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

export function isAllowedImageMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, mime);
}

export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? '.bin';
}

/**
 * Builds a storage key. The server names the file — a user-supplied filename is
 * never used, which removes path traversal as a category (spec 23).
 */
export function buildStorageKey(mimeType: string, observedAt = new Date()): string {
  const year = observedAt.getUTCFullYear();
  const month = String(observedAt.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${crypto.randomUUID()}${extensionForMime(mimeType)}`;
}

export class LocalFilesystemStorage implements AssetStorage {
  constructor(private readonly rootDir: string = env.uploadDir) {}

  /** Resolves a key inside the root and refuses anything that escapes it. */
  private resolve(storageKey: string): string {
    const resolved = path.resolve(this.rootDir, storageKey);
    const root = path.resolve(this.rootDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Storage key escapes the storage root: ${storageKey}`);
    }
    return resolved;
  }

  async publish(temporaryPath: string, storageKey: string): Promise<void> {
    const target = this.resolve(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.rename(temporaryPath, target);
    } catch (error) {
      // rename fails across volumes; fall back to copy + unlink.
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(temporaryPath, target);
        await fs.unlink(temporaryPath);
        return;
      }
      throw error;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolve(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await fs.rm(this.resolve(storageKey), { force: true });
  }

  publicUrl(storageKey: string): string {
    return `/uploads/${storageKey.split(path.sep).join('/')}`;
  }
}

export const assetStorage: AssetStorage = new LocalFilesystemStorage();

/**
 * Decodes a `data:image/...;base64,...` URI into the import temp directory.
 *
 * Base64 is never persisted in MySQL (spec 67.3). The caller publishes the
 * staged file into storage inside the import transaction and removes it on
 * rollback.
 */
export async function stageDataUri(dataUri: string): Promise<StoredAsset & { temporaryPath: string }> {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUri.trim());
  if (!match) throw new Error('Expected a data:<mime>;base64,<payload> URI.');

  const mimeType = match[1]!.toLowerCase();
  if (!isAllowedImageMime(mimeType)) {
    throw new Error(`MIME type not allowed for application images: ${mimeType}`);
  }

  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length === 0) throw new Error('Decoded asset is empty.');

  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error(`Decoded asset is ${bytes.length} bytes, over the ${env.MAX_UPLOAD_MB} MB limit.`);
  }

  const storageKey = buildStorageKey(mimeType);
  const temporaryPath = path.join(env.importTempDir, `${crypto.randomUUID()}.part`);
  await fs.mkdir(env.importTempDir, { recursive: true });
  await fs.writeFile(temporaryPath, bytes);

  return {
    temporaryPath,
    storageKey,
    filename: path.basename(storageKey),
    mimeType,
    fileSize: bytes.length,
    checksumSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}
