import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesController } from '../files/files.controller';
import { FilesService } from '../files/files.service';
import { Env } from '../config/env';
import { LocalStorageService, R2StorageService, StorageService } from './storage.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): StorageService =>
        config.get('STORAGE_DRIVER', { infer: true }) === 'r2'
          ? new R2StorageService(config)
          : new LocalStorageService(config),
    },
  ],
  exports: [StorageService, FilesService],
})
export class StorageModule {}
