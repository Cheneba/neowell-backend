import { Injectable, Logger } from '@nestjs/common';

/**
 * Outbound SMS port. Drivers (console, twilio, …) implement `send` and are chosen by
 * SMS_PROVIDER in `notifications.module.ts`. To add a provider, implement this class,
 * add its name to the env enum and register it in the module's factory.
 */
export abstract class SmsService {
  /** Throws when the provider rejects the message, so callers (and the job queue) can retry. */
  abstract send(phone: string, message: string): Promise<void>;
}

/** Development driver: prints the message to the server log. */
@Injectable()
export class ConsoleSmsService extends SmsService {
  private readonly logger = new Logger('SMS');

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`→ ${phone}: ${message}`);
  }
}
