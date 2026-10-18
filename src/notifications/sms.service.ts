import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';

/**
 * Outbound SMS. `console` logs in development; `twilio` delivers via the
 * Twilio Messages API — also the channel for the SMS fallback alerts
 * described in PDR §12.
 */
export abstract class SmsService {
  abstract send(phone: string, message: string): Promise<void>;
}

@Injectable()
export class ConsoleSmsService extends SmsService {
  private readonly logger = new Logger('SMS');

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`→ ${phone}: ${message}`);
  }
}

/** Twilio REST API — no SDK needed for a single endpoint. */
@Injectable()
export class TwilioSmsService extends SmsService {
  private readonly logger = new Logger('SMS');
  private readonly sid: string;
  private readonly token: string;
  private readonly from?: string;
  private readonly messagingServiceSid?: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.sid = config.get('TWILIO_ACCOUNT_SID', { infer: true }) as string;
    this.token = config.get('TWILIO_AUTH_TOKEN', { infer: true }) as string;
    this.from = config.get('TWILIO_FROM', { infer: true });
    this.messagingServiceSid = config.get('TWILIO_MESSAGING_SERVICE_SID', { infer: true });
  }

  async send(phone: string, message: string): Promise<void> {
    const body = new URLSearchParams({ To: phone, Body: message });
    // A Messaging Service takes precedence — it handles sender pooling/opt-out.
    if (this.messagingServiceSid) body.set('MessagingServiceSid', this.messagingServiceSid);
    else body.set('From', this.from as string);

    const auth = Buffer.from(`${this.sid}:${this.token}`).toString('base64');
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Twilio SMS failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    this.logger.log(`SMS delivered via Twilio to ${maskPhone(phone)}`);
  }
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? '****' : `****${phone.slice(-4)}`;
}
