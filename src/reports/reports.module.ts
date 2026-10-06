import { Module } from '@nestjs/common';
import { BabiesModule } from '../babies/babies.module';
import { ChecksModule } from '../checks/checks.module';
import { GrowthModule } from '../growth/growth.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BabiesModule, ChecksModule, GrowthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
