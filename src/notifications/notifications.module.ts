import { Global, Module } from '@nestjs/common';
import { ConsoleSmsService, SmsService } from './sms.service';

@Global()
@Module({
  providers: [{ provide: SmsService, useClass: ConsoleSmsService }],
  exports: [SmsService],
})
export class NotificationsModule {}
