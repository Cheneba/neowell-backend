import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Env } from '../config/env';

export interface SignedFile {
  key: string;
  mime: string;
  exp: number;
}

const DEFAULT_TTL_SECONDS = 600;

/** Short-lived signed links for stored files (NFR-SEC-03): `/files/<payload>.<hmac>`. */
@Injectable()
export class FilesService {
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get('FILE_URL_SECRET', { infer: true });
    this.baseUrl = config.get('PUBLIC_BASE_URL', { infer: true }).replace(/\/$/, '');
  }

  url(
    key: string | null | undefined,
    mime = guessMime(key ?? ''),
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): string | null {
    if (!key) return null;
    const payload = Buffer.from(
      JSON.stringify({
        key,
        mime,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      } satisfies SignedFile),
    ).toString('base64url');
    return `${this.baseUrl}/files/${payload}.${this.sign(payload)}`;
  }

  verify(token: string): SignedFile | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SignedFile;
      return data.exp >= Math.floor(Date.now() / 1000) ? data : null;
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

export function guessMime(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  return (
    (
      {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        pdf: 'application/pdf',
        m4a: 'audio/mp4',
        mp4: 'audio/mp4',
        aac: 'audio/aac',
        mp3: 'audio/mpeg',
        webm: 'audio/webm',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
      } as Record<string, string>
    )[ext ?? ''] ?? 'application/octet-stream'
  );
}
