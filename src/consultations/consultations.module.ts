import { Module } from '@nestjs/common';
import { BabiesModule } from '../babies/babies.module';
import { ReportsModule } from '../reports/reports.module';
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
  providers: [ConsultationsService, MessagesService, CallsService, CareService],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
