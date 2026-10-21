import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { FilesController } from '../files/files.controller';
import { FilesService } from '../files/files.service';
import { R2StorageService } from './storage.r2';
import { LocalStorageService, StorageService } from './storage.service';

/** Picks the storage driver from STORAGE_DRIVER. Add a provider = one new case here. */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>): StorageService => {
        if (c.get('STORAGE_DRIVER', { infer: true }) === 'r2')
          return new R2StorageService({
            accountId: c.get('R2_ACCOUNT_ID', { infer: true }),
            endpoint: c.get('R2_ENDPOINT', { infer: true }),
            region: c.get('R2_REGION', { infer: true }),
            accessKeyId: c.get('R2_ACCESS_KEY_ID', { infer: true })!,
            secretAccessKey: c.get('R2_SECRET_ACCESS_KEY', { infer: true })!,
            bucket: c.get('R2_BUCKET', { infer: true })!,
          });
        return new LocalStorageService(c);
      },
    },
    FilesService,
  ],
  exports: [StorageService, FilesService],
})
export class StorageModule {}
