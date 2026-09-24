import { Injectable, Logger } from '@nestjs/common';

/**
 * Outbound SMS. Only a development driver exists today; a real gateway
 * (e.g. an MTN/Orange aggregator) plugs in here — it is also the channel for
 * the SMS fallback alerts described in PDR §12.
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
