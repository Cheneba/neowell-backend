import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { BabiesModule } from '../babies/babies.module';
import { ReportsModule } from '../reports/reports.module';
import { CallProvider, DisabledCallProvider } from './call-provider';
import { LiveKitCallProvider } from './call-provider.livekit';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CareService } from './care.service';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { MessagesService } from './messages.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [BabiesModule, ReportsModule],
  controllers: [ConsultationsController, CallsController, WebhooksController],
  providers: [
    {
      provide: CallProvider,
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>): CallProvider => {
        const url = c.get('LIVEKIT_URL', { infer: true });
        const key = c.get('LIVEKIT_API_KEY', { infer: true });
        const secret = c.get('LIVEKIT_API_SECRET', { infer: true });
        return url && key && secret
          ? new LiveKitCallProvider(url, key, secret)
          : new DisabledCallProvider();
      },
    },
    ConsultationsService, MessagesService, CallsService, CareService],
  exports: [ConsultationsService, CallProvider],
})
export class ConsultationsModule {}
