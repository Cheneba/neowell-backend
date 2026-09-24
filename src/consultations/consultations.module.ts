import { Module } from '@nestjs/common';
import { BabiesModule } from '../babies/babies.module';
import { ReportsModule } from '../reports/reports.module';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';

@Module({
  imports: [BabiesModule, ReportsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
})
export class ConsultationsModule {}
