import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { ConsoleSmsService, SmsService, TwilioSmsService } from './sms.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: SmsService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('SMS_PROVIDER', { infer: true }) === 'twilio'
          ? new TwilioSmsService(config)
          : new ConsoleSmsService(),
    },
    PushService,
    NotificationsService,
  ],
  exports: [SmsService, NotificationsService],
})
export class NotificationsModule {}
