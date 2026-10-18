import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Env } from '../config/env';
import { guessMime } from '../files/files.service';

/**
 * Private object storage for PHI and credential documents (NFR-SEC-03).
 * Two drivers exist: `local` for development/tests, and `r2` for production —
 * any S3-compatible endpoint (Cloudflare R2), with encryption at rest.
 * Files are only ever served through signed links.
 */
export abstract class StorageService {
  /** Stores the bytes under `prefix/` and returns the opaque storage key. */
  abstract put(prefix: string, originalName: string, data: Buffer): Promise<string>;
  abstract read(key: string): Promise<Buffer>;
  abstract delete(keys: string[]): Promise<void>;

  protected objectKey(prefix: string, originalName: string): string {
    const ext = extname(originalName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '');
    return `${prefix}/${randomUUID()}${ext}`;
  }
}

@Injectable()
export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.root = resolve(config.get('STORAGE_LOCAL_DIR', { infer: true }));
  }

  async put(prefix: string, originalName: string, data: Buffer): Promise<string> {
    const key = this.objectKey(prefix, originalName);
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { mode: 0o600 });
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => rm(this.pathFor(k), { force: true })));
  }

  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + '/')) throw new Error('Invalid storage key');
    return path;
  }
}

/** Cloudflare R2 (or any S3-compatible service) driver. */
@Injectable()
export class R2StorageService extends StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    const accountId = config.get('R2_ACCOUNT_ID', { infer: true });
    const endpoint =
      config.get('R2_ENDPOINT', { infer: true }) ??
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    this.bucket = config.get('R2_BUCKET', { infer: true }) as string;
    this.client = new S3Client({
      region: config.get('R2_REGION', { infer: true }),
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID', { infer: true }) as string,
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY', { infer: true }) as string,
      },
    });
  }

  async put(prefix: string, originalName: string, data: Buffer): Promise<string> {
    const key = this.objectKey(prefix, originalName);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: guessMime(key),
      }),
    );
    return key;
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty object: ${key}`);
    return Buffer.from(bytes);
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map((key) => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))),
    );
  }
}
