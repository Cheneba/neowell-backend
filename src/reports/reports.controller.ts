import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BabiesService } from '../babies/babies.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Roles(Role.CAREGIVER)
@Controller('babies/:babyId')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly babies: BabiesService,
  ) {}

  @Get('summary')
  @ApiQuery({ name: 'days', enum: [3, 7], required: false })
  async summary(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query('days') days?: string,
  ) {
    assertWindow(days);
    await this.babies.findOwned(user.id, babyId);
    return this.reports.summary(babyId, days === '3' ? 3 : 7);
  }

  @Get('summary.pdf')
  @ApiQuery({ name: 'days', enum: [3, 7], required: false })
  @ApiQuery({ name: 'lang', enum: ['en', 'fr'], required: false })
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('days') days?: string,
    @Query('lang') lang?: string,
  ) {
    assertWindow(days);
    await this.babies.findOwned(user.id, babyId);
    const pdf = await this.reports.pdf(babyId, days === '3' ? 3 : 7, lang === 'fr' ? 'fr' : 'en');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="neowell-summary-${days === '3' ? 3 : 7}d.pdf"`,
    );
    return new StreamableFile(pdf);
  }
}

/** Only 3- and 7-day summaries exist (FR-RPT-01). */
function assertWindow(days?: string) {
  if (days !== undefined && days !== '3' && days !== '7') {
    throw new BadRequestException('days must be 3 or 7');
  }
}
