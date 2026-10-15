import { Injectable, Logger } from '@nestjs/common';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outbound email port. Drivers (console, smtp, …) are chosen by EMAIL_PROVIDER in
 * `notifications.module.ts`. SMTP already covers most services (Resend, Brevo, SES, Gmail…).
 */
export abstract class EmailService {
  /** Throws when the provider rejects the message, so the job queue can retry. */
  abstract send(message: EmailMessage): Promise<void>;
}

/** Development driver: prints the message to the server log. */
@Injectable()
export class ConsoleEmailService extends EmailService {
  private readonly logger = new Logger('Email');

  async send(m: EmailMessage): Promise<void> {
    this.logger.log(`→ ${m.to}: ${m.subject}\n${m.text}`);
  }
}
