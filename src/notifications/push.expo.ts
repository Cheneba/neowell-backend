import { PushMessage, PushService, PushTicket } from './push.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo Push API (docs/05 Q2, J10). Needs Expo push tokens (`ExponentPushToken[...]`). */
export class ExpoPushService extends PushService {
  constructor(
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async send(message: PushMessage): Promise<PushTicket> {
    const res = await this.fetchImpl(EXPO_PUSH_URL, {
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
    if (!ids.length) return {};
    const res = await this.fetchImpl(EXPO_RECEIPTS_URL, {
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
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }
}
