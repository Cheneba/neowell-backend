import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { callPageHtml, CallsService } from './calls.service';

/** Public call page opened from the app with a signed link (FR-CONS-09). */
@ApiExcludeController()
@Public()
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  async page(@Param('token') token: string, @Res() res: Response) {
    const data = await this.calls.pageData(token);
    const lkHost = new URL(data.url).host;
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'unsafe-inline'",
        `connect-src wss://${lkHost} https://${lkHost} ws://${lkHost}`,
        'media-src blob: mediastream:',
        "img-src 'self' data:",
      ].join('; '),
    );
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    res.type('html').send(callPageHtml(data));
  }
}
