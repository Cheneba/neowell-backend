import { Logger } from '@nestjs/common';
import { SmsService } from './sms.service';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from?: string;
  messagingServiceSid?: string;
}

/** Twilio Programmable SMS over its REST API (no SDK needed). */
export class TwilioSmsService extends SmsService {
  private readonly logger = new Logger('SMS');

  constructor(
    private readonly cfg: TwilioConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async send(phone: string, message: string): Promise<void> {
    const body = new URLSearchParams({ To: phone, Body: message });
    if (this.cfg.messagingServiceSid) body.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else body.set('From', this.cfg.from!);
    const res = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
      this.logger.warn(`Twilio ${res.status} (code ${err.code ?? '-'}) sending to ${phone}`);
      throw new Error(`Twilio error ${err.code ?? res.status}: ${err.message ?? 'send failed'}`);
    }
  }
}
