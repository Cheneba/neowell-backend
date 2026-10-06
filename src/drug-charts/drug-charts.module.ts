import { Module } from '@nestjs/common';
import { BabiesModule } from '../babies/babies.module';
import { DrugChartsController } from './drug-charts.controller';
import { DrugChartsService } from './drug-charts.service';

@Module({
  imports: [BabiesModule],
  controllers: [DrugChartsController],
  providers: [DrugChartsService],
})
export class DrugChartsModule {}
