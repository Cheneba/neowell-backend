import { Module } from '@nestjs/common';
import { BabiesController } from './babies.controller';
import { BabiesService } from './babies.service';

@Module({
  controllers: [BabiesController],
  providers: [BabiesService],
  exports: [BabiesService],
})
export class BabiesModule {}
