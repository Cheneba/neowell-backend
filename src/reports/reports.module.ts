import { Module } from '@nestjs/common';
import { BabiesModule } from '../babies/babies.module';
import { ObservationsModule } from '../observations/observations.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BabiesModule, ObservationsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
