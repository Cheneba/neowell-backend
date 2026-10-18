import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { Env } from '../config/env';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type PushTicket =
  { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Push client (docs/05 Q2, J10). Drivers:
 * - `expo`: Expo Push API (ExpoPushToken).
 * - `fcm`: Firebase Cloud Messaging HTTP v1 (native FCM registration token).
 * - `log`: logs only (tests, local).
 * FCM has no receipt endpoint; `receipts()` is a no-op there, so dead tokens are
 * pruned from the synchronous send error instead (see `checkReceipts`).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  private readonly driver: 'expo' | 'log' | 'fcm';
  private readonly token?: string;
  private readonly serviceAccount?: ServiceAccount;
  private messagingClient?: Messaging;

  constructor(config: ConfigService<Env, true>) {
    this.driver = config.get('PUSH_DRIVER', { infer: true });
    this.token = config.get('EXPO_ACCESS_TOKEN', { infer: true });
    if (this.driver === 'fcm') {
      this.serviceAccount = parseServiceAccount(
        config.get('FIREBASE_SERVICE_ACCOUNT', { infer: true }),
      );
    }
  }

  async send(message: PushMessage): Promise<PushTicket> {
    if (this.driver === 'log') {
      this.logger.log(`→ ${message.to}: ${message.title} — ${message.body}`);
      return { status: 'ok', id: `log-${Date.now()}` };
    }
    if (this.driver === 'fcm') return this.sendFcm(message);

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify([
        { ...message, sound: 'default', priority: 'high', channelId: 'default' },
      ]),
    });
    if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
    const json = (await res.json()) as { data: PushTicket[] };
    return json.data[0];
  }

  async receipts(ids: string[]): Promise<Record<string, PushTicket>> {
    if (this.driver !== 'expo' || !ids.length) return {};
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`Expo receipts HTTP ${res.status}`);
    return ((await res.json()) as { data: Record<string, PushTicket> }).data;
  }

  /** FCM data payload values must be strings. */
  private async sendFcm(message: PushMessage): Promise<PushTicket> {
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(message.data ?? {})) {
      data[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    try {
      const id = await this.messaging().send({
        token: message.to,
        notification: { title: message.title, body: message.body },
        data,
        android: { priority: 'high', notification: { sound: 'default', channelId: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      return { status: 'ok', id };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code && DEAD_TOKEN_CODES.has(code)) {
        return {
          status: 'error',
          message: (e as Error).message,
          details: { error: 'DeviceNotRegistered' },
        };
      }
      throw e;
    }
  }

  private messaging(): Messaging {
    if (!this.messagingClient) {
      const app = getApps().length
        ? getApps()[0]
        : initializeApp({ credential: cert(this.serviceAccount!) });
      this.messagingClient = getMessaging(app);
    }
    return this.messagingClient;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }
}

/** Accepts the service-account JSON either raw or base64-encoded. */
function parseServiceAccount(value?: string): ServiceAccount {
  if (!value) throw new Error('FIREBASE_SERVICE_ACCOUNT is required when PUSH_DRIVER=fcm');
  const text = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  try {
    return JSON.parse(text) as ServiceAccount;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON (or base64-encoded JSON)');
  }
}
