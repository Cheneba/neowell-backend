import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from '../admin/admin.module';
import { BabiesModule } from '../babies/babies.module';
import { ChecksModule } from '../checks/checks.module';
import { ConsultationsModule } from '../consultations/consultations.module';
import { MaintenanceService } from './maintenance.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), AdminModule, BabiesModule, ChecksModule, ConsultationsModule],
  providers: [SchedulerService, MaintenanceService],
  exports: [SchedulerService, MaintenanceService],
})
export class SchedulerModule {}
