import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { CollectRequest, GatewayResult, GatewayStatus, PaymentGateway } from './payment-gateway';

/**
 * CamPay aggregator (MTN MoMo + Orange Money, FR-PAY / docs/05 W1/Q4/Q5).
 * Auth is either a permanent token from the dashboard or a short-lived token
 * fetched with the app username/password. Collections are approved by the payer
 * on their phone; status is polled as a webhook backup.
 */
@Injectable()
export class CamPayGateway extends PaymentGateway {
  /** Mobile-money approval is not instant. */
  readonly firstPollDelayMs = 5_000;
  private readonly base: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly permanentToken?: string;
  private token?: string;
  private tokenExpiresAt = 0;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.base = (config.get('CAMPAY_BASE_URL', { infer: true }) as string).replace(/\/+$/, '');
    this.username = config.get('CAMPAY_APP_USERNAME', { infer: true });
    this.password = config.get('CAMPAY_APP_PASSWORD', { infer: true });
    this.permanentToken = config.get('CAMPAY_PERMANENT_TOKEN', { infer: true });
  }

  async collect(req: CollectRequest): Promise<GatewayResult> {
    const res = await this.request<{ reference: string; status?: string; reason?: string }>(
      'collect/',
      {
        amount: String(req.amountXaf),
        currency: 'XAF',
        from: normalizePhone(req.payerPhone),
        description: req.description,
        external_reference: req.paymentId,
      },
    );
    return { externalRef: res.reference, status: mapStatus(res.status), reason: res.reason };
  }

  async status(payment: {
    externalRef: string;
    payerPhone: string;
  }): Promise<{ status: GatewayStatus; reason?: string }> {
    const res = await this.request<{ status?: string; reason?: string }>(
      `transaction/${encodeURIComponent(payment.externalRef)}/`,
      undefined,
      'GET',
    );
    return { status: mapStatus(res.status), reason: res.reason };
  }

  async refund(req: {
    originalRef: string;
    amountXaf: number;
    payerPhone: string;
  }): Promise<GatewayResult> {
    const res = await this.request<{ reference: string; status?: string; reason?: string }>(
      'deposit/',
      {
        amount: String(req.amountXaf),
        currency: 'XAF',
        to: normalizePhone(req.payerPhone),
        description: `NeoWell refund ${req.originalRef.slice(0, 12)}`,
        external_reference: `refund-${req.originalRef}`,
      },
    );
    return { externalRef: res.reference, status: mapStatus(res.status), reason: res.reason };
  }

  private async authToken(): Promise<string> {
    if (this.permanentToken) return this.permanentToken;
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (!this.username || !this.password) throw new Error('CamPay credentials are not configured');
    const res = await fetch(`${this.base}/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`CamPay auth failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    const json = JSON.parse(text) as { token: string; expires_in?: number };
    this.token = json.token;
    // Refresh a little early to avoid racing the expiry.
    this.tokenExpiresAt = Date.now() + Math.max((json.expires_in ?? 3600) - 60, 60) * 1000;
    return this.token;
  }

  private async request<T>(
    path: string,
    body?: Record<string, unknown>,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<T> {
    const token = await this.authToken();
    const res = await fetch(`${this.base}/${path}`, {
      method,
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`CamPay ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** CamPay expects MSISDN without the leading `+` (e.g. 2376xxxxxxxx). */
function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, '');
}

function mapStatus(status?: string): GatewayStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCESSFUL':
    case 'SUCCESS':
      return 'SUCCESSFUL';
    case 'FAILED':
    case 'FAILURE':
    case 'CANCELLED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}
