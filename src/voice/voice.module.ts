import { Module } from '@nestjs/common';
import { BabiesModule } from '../babies/babies.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [BabiesModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
