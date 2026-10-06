import { Global, Module } from '@nestjs/common';
import { FilesController } from '../files/files.controller';
import { FilesService } from '../files/files.service';
import { LocalStorageService, StorageService } from './storage.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [{ provide: StorageService, useClass: LocalStorageService }, FilesService],
  exports: [StorageService, FilesService],
})
export class StorageModule {}
