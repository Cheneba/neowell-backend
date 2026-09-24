import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Env } from '../config/env';
import { CliniciansController } from './clinicians.controller';
import { CliniciansService } from './clinicians.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        storage: memoryStorage(),
        limits: { fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024, files: 1 },
      }),
    }),
  ],
  controllers: [CliniciansController],
  providers: [CliniciansService],
})
export class CliniciansModule {}
