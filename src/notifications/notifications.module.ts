import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { ConsoleEmailService, EmailService } from './email.service';
import { SmtpEmailService } from './email.smtp';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FcmPushService } from './push.fcm';
import { ExpoPushService } from './push.expo';
import { LogPushService, PushService } from './push.service';
import { ConsoleSmsService, SmsService } from './sms.service';
import { TwilioSmsService } from './sms.twilio';

type Cfg = ConfigService<Env, true>;

/** Picks each third-party driver from env. Add a provider = one new case here + one env value. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: SmsService,
      inject: [ConfigService],
      useFactory: (c: Cfg): SmsService => {
        switch (c.get('SMS_PROVIDER', { infer: true })) {
          case 'twilio':
            return new TwilioSmsService({
              accountSid: c.get('TWILIO_ACCOUNT_SID', { infer: true })!,
              authToken: c.get('TWILIO_AUTH_TOKEN', { infer: true })!,
              from: c.get('TWILIO_FROM', { infer: true }),
              messagingServiceSid: c.get('TWILIO_MESSAGING_SERVICE_SID', { infer: true }),
            });
          default:
            return new ConsoleSmsService();
        }
      },
    },
    {
      provide: EmailService,
      inject: [ConfigService],
      useFactory: (c: Cfg): EmailService => {
        switch (c.get('EMAIL_PROVIDER', { infer: true })) {
          case 'smtp':
            return new SmtpEmailService({
              host: c.get('SMTP_HOST', { infer: true })!,
              port: c.get('SMTP_PORT', { infer: true }),
              secure: c.get('SMTP_SECURE', { infer: true }),
              user: c.get('SMTP_USER', { infer: true }),
              pass: c.get('SMTP_PASS', { infer: true }),
              from: c.get('EMAIL_FROM', { infer: true }),
            });
          default:
            return new ConsoleEmailService();
        }
      },
    },
    {
      provide: PushService,
      inject: [ConfigService],
      useFactory: (c: Cfg): PushService => {
        switch (c.get('PUSH_DRIVER', { infer: true })) {
          case 'fcm':
            return new FcmPushService(c.get('FIREBASE_SERVICE_ACCOUNT', { infer: true })!);
          case 'expo':
            return new ExpoPushService(c.get('EXPO_ACCESS_TOKEN', { infer: true }));
          default:
            return new LogPushService();
        }
      },
    },
    NotificationsService,
  ],
  exports: [SmsService, EmailService, PushService, NotificationsService],
})
export class NotificationsModule {}
