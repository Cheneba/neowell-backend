import { Module } from '@nestjs/common';
import { ConsultationsModule } from '../consultations/consultations.module';
import { VoiceModule } from '../voice/voice.module';
import { AdminController } from './admin.controller';
import { IntegrationsController } from './integrations.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ConsultationsModule, VoiceModule],
  controllers: [AdminController, IntegrationsController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
