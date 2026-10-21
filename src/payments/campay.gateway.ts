import {
  CollectRequest,
  GatewayResult,
  GatewayStatus,
  PaymentGateway,
} from './payment-gateway';

export interface CampayConfig {
  baseUrl: string;
  /** Either a permanent access token, or an app username + password. */
  permanentToken?: string;
  username?: string;
  password?: string;
}

type FetchLike = typeof fetch;

/** Campay: "237XXXXXXXXX" with no plus sign. */
const toMsisdn = (phone: string) => phone.replace(/\D/g, '');

/**
 * Campay (MTN MoMo + Orange Money) adapter. Status is polled by the `payment.status` job, so
 * Campay's webhook is not needed. Refunds are sent back with a withdrawal.
 */
export class CampayPaymentGateway extends PaymentGateway {
  readonly firstPollDelayMs = 15_000;
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly cfg: CampayConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    super();
  }

  async collect(req: CollectRequest): Promise<GatewayResult> {
    const res = await this.call<{ reference: string }>('POST', '/collect/', {
      amount: String(req.amountXaf),
      from: toMsisdn(req.payerPhone),
      description: req.description,
      external_reference: req.paymentId,
    });
    return { externalRef: res.reference, status: 'PENDING' };
  }

  async status(payment: { externalRef: string }) {
    const res = await this.call<{ status: string; reason?: string }>(
      'GET',
      `/transaction/${encodeURIComponent(payment.externalRef)}/`,
    );
    const status: GatewayStatus =
      res.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : res.status === 'FAILED' ? 'FAILED' : 'PENDING';
    return { status, reason: status === 'FAILED' ? (res.reason ?? 'Payment failed') : undefined };
  }

  async refund(req: {
    originalRef: string;
    amountXaf: number;
    payerPhone: string;
  }): Promise<GatewayResult> {
    const res = await this.call<{ reference: string }>('POST', '/withdraw/', {
      amount: String(req.amountXaf),
      to: toMsisdn(req.payerPhone),
      description: 'NeoWell refund',
      external_reference: `refund-${req.originalRef}`,
    });
    return { externalRef: res.reference, status: 'PENDING' };
  }

  private async getToken(): Promise<string> {
    if (this.cfg.permanentToken) return this.cfg.permanentToken;
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string };
    if (!res.ok || !body.token) throw new Error(`Campay auth failed (${res.status})`);
    // Campay tokens last about 3 minutes; refresh a little early.
    this.token = { value: body.token, expiresAt: Date.now() + 120_000 };
    return body.token;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${await this.getToken()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401) this.token = undefined;
      const msg = (json.message ?? json.detail ?? json.error ?? 'request failed') as string;
      throw new Error(`Campay ${method} ${path} failed (${res.status}): ${msg}`);
    }
    return json as T;
  }
}
