import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

/** Expo Push API client (docs/05 Q2, J10). The `log` driver only logs (tests, local). */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  private readonly driver: 'expo' | 'log';
  private readonly token?: string;

  constructor(config: ConfigService<Env, true>) {
    this.driver = config.get('PUSH_DRIVER', { infer: true });
    this.token = config.get('EXPO_ACCESS_TOKEN', { infer: true });
  }

  async send(message: PushMessage): Promise<PushTicket> {
    if (this.driver === 'log') {
      this.logger.log(`→ ${message.to}: ${message.title} — ${message.body}`);
      return { status: 'ok', id: `log-${Date.now()}` };
    }
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
    if (this.driver === 'log' || !ids.length) return {};
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`Expo receipts HTTP ${res.status}`);
    return ((await res.json()) as { data: Record<string, PushTicket> }).data;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }
}
