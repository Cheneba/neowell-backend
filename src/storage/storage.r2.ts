import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { guessMime } from '../files/files.service';
import { StorageService } from './storage.service';

export interface R2Config {
  accountId?: string;
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Cloudflare R2 (S3-compatible). The bucket stays private: files are only ever served
 * by the API through signed links (see FilesController), never by public bucket URLs.
 */
export class R2StorageService extends StorageService {
  constructor(
    private readonly cfg: R2Config,
    private readonly s3: Pick<S3Client, 'send'> = new S3Client({
      region: cfg.region ?? 'auto',
      endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    }),
  ) {
    super();
  }

  async put(prefix: string, originalName: string, data: Buffer): Promise<string> {
    const ext = extname(originalName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '');
    const key = `${prefix}/${randomUUID()}${ext}`;
    await this.s3.send(new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: data,
        ContentType: guessMime(key),
      }),);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(keys: string[]): Promise<void> {
    // DeleteObjects takes up to 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.cfg.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }
}
