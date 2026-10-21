import { createSign } from 'node:crypto';
import { PushMessage, PushService, PushTicket } from './push.service';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Accepts the service-account JSON as-is or base64-encoded. */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text) as Partial<ServiceAccount>;
  if (!sa.project_id || !sa.client_email || !sa.private_key)
    throw new Error('FIREBASE_SERVICE_ACCOUNT must contain project_id, client_email and private_key');
  return sa as ServiceAccount;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/**
 * Firebase Cloud Messaging (HTTP v1) using a service account — no SDK.
 * Needs raw FCM device tokens (the app's native token, not an Expo token).
 */
export class FcmPushService extends PushService {
  private readonly sa: ServiceAccount;
  private cached?: { token: string; expiresAt: number };

  constructor(
    serviceAccount: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
    this.sa = parseServiceAccount(serviceAccount);
  }

  async send(message: PushMessage): Promise<PushTicket> {
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.to,
            notification: { title: message.title, body: message.body },
            // FCM data payloads only accept string values.
            data: Object.fromEntries(
              Object.entries(message.data ?? {}).map(([k, v]) => [
                k,
                typeof v === 'string' ? v : JSON.stringify(v),
              ]),
            ),
            android: { priority: 'HIGH', notification: { channel_id: 'default', sound: 'default' } },
          },
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      name?: string;
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    };
    if (res.ok) return { status: 'ok', id: json.name ?? `fcm-${Date.now()}` };

    const code = json.error?.details?.find((d) => d.errorCode)?.errorCode;
    const dead = code === 'UNREGISTERED' || json.error?.status === 'NOT_FOUND';
    // Throttling/outages are retried by the job queue; bad tokens are final.
    if (!dead && (res.status >= 500 || res.status === 429))
      throw new Error(`FCM HTTP ${res.status}: ${json.error?.message ?? ''}`);
    return {
      status: 'error',
      message: json.error?.message ?? `FCM HTTP ${res.status}`,
      details: dead ? { error: 'DeviceNotRegistered' } : { error: code ?? json.error?.status },
    };
  }

  /** FCM reports failures synchronously, so there are no receipts to fetch. */
  async receipts(): Promise<Record<string, PushTicket>> {
    return {};
  }

  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({
        iss: this.sa.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.sa.private_key);
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${b64url(signature)}`,
      }),
    });
    if (!res.ok) throw new Error(`Google OAuth HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}
