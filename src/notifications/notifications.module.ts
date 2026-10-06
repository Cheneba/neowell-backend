import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { ConsoleSmsService, SmsService } from './sms.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: SmsService, useClass: ConsoleSmsService },
    PushService,
    NotificationsService,
  ],
  exports: [SmsService, NotificationsService],
})
export class NotificationsModule {}
