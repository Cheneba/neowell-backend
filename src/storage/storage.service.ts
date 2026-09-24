import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Env } from '../config/env';

/**
 * Private object storage for PHI and credential documents.
 * Only a local-disk driver exists; swap in S3/GCS (with server-side encryption)
 * before production (PDR §6 "encrypted stored PHI").
 */
export abstract class StorageService {
  /** Stores the bytes under `prefix/` and returns the opaque storage key. */
  abstract put(prefix: string, originalName: string, data: Buffer): Promise<string>;
}

@Injectable()
export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.root = resolve(config.get('STORAGE_LOCAL_DIR', { infer: true }));
  }

  async put(prefix: string, originalName: string, data: Buffer): Promise<string> {
    const ext = extname(originalName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '');
    const key = `${prefix}/${randomUUID()}${ext}`;
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { mode: 0o600 });
    return key;
  }
}
