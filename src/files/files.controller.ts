import { Controller, Get, NotFoundException, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { StorageService } from '../storage/storage.service';
import { FilesService } from './files.service';

@ApiTags('files')
@Public()
@SkipThrottle()
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly storage: StorageService,
  ) {}

  /** Serves a stored file through a signed, expiring link. */
  @Get(':token')
  async get(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const file = this.files.verify(token);
    if (!file) throw new NotFoundException();
    const data = await this.storage.read(file.key).catch(() => {
      throw new NotFoundException();
    });
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=600');
    return new StreamableFile(data);
  }
}
