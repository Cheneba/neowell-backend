import { createTransport, Transporter } from 'nodemailer';
import { EmailMessage, EmailService } from './email.service';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Any SMTP server, through nodemailer. */
export class SmtpEmailService extends EmailService {
  private readonly transport: Transporter;

  constructor(
    private readonly cfg: SmtpConfig,
    transport?: Transporter,
  ) {
    super();
    this.transport =
      transport ??
      createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      });
  }

  async send(m: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.cfg.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
  }
}
