import { Injectable, Logger } from '@nestjs/common';

export interface PushMessage {
  /** The device's push token, as issued by the active driver. */
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type PushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

/**
 * Mobile push port. Drivers (log, expo, fcm, …) are chosen by PUSH_DRIVER in
 * `notifications.module.ts`. A driver reports a dead token as `details.error = 'DeviceNotRegistered'`
 * so the caller can drop the device.
 */
export abstract class PushService {
  abstract send(message: PushMessage): Promise<PushTicket>;
  /** Delivery receipts for earlier tickets, for providers that report them later. */
  abstract receipts(ids: string[]): Promise<Record<string, PushTicket>>;
}

/** Development/test driver: only logs. */
@Injectable()
export class LogPushService extends PushService {
  private readonly logger = new Logger('Push');

  async send(message: PushMessage): Promise<PushTicket> {
    this.logger.log(`→ ${message.to}: ${message.title} — ${message.body}`);
    return { status: 'ok', id: `log-${Date.now()}` };
  }

  async receipts(): Promise<Record<string, PushTicket>> {
    return {};
  }
}
