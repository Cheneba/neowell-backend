import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type GatewayStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

export interface CollectRequest {
  paymentId: string;
  amountXaf: number;
  payerPhone: string;
  operator: 'MTN_MOMO' | 'ORANGE_MONEY' | 'SANDBOX';
  description: string;
}

export interface GatewayResult {
  externalRef: string;
  status: GatewayStatus;
  reason?: string;
}

/**
 * Mobile-money aggregator adapter (FR-PAY, docs/05 W1/Q4/Q5). A live adapter for the chosen
 * aggregator (MTN MoMo + Orange Money) implements the same three calls.
 */
export abstract class PaymentGateway {
  /** Starts a collection; the payer approves it on their phone. */
  abstract collect(req: CollectRequest): Promise<GatewayResult>;
  /** Current status of a collection or refund. */
  abstract status(payment: {
    externalRef: string;
    payerPhone: string;
  }): Promise<{ status: GatewayStatus; reason?: string }>;
  /** Sends money back to the payer. */
  abstract refund(req: {
    originalRef: string;
    amountXaf: number;
    payerPhone: string;
  }): Promise<GatewayResult>;
  /** Delay before the first status poll. */
  abstract readonly firstPollDelayMs: number;
}

/**
 * Sandbox (FR-PAY-04): every collection succeeds after a short delay, except payer numbers
 * ending in 000, which fail. Refunds succeed immediately.
 */
@Injectable()
export class SandboxPaymentGateway extends PaymentGateway {
  readonly firstPollDelayMs = 3_000;

  async collect(): Promise<GatewayResult> {
    return { externalRef: `SBX-${randomUUID()}`, status: 'PENDING' };
  }

  async status(payment: { payerPhone: string }) {
    return payment.payerPhone.endsWith('000')
      ? { status: 'FAILED' as const, reason: 'Sandbox: payer declined' }
      : { status: 'SUCCESSFUL' as const };
  }

  async refund(): Promise<GatewayResult> {
    return { externalRef: `SBX-R-${randomUUID()}`, status: 'SUCCESSFUL' };
  }
}
