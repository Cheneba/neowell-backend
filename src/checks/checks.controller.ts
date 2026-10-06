import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { ChecksService } from './checks.service';
import {
  CheckPlanQuery,
  CreateObservationDto,
  ListObservationsQuery,
  RechecksQuery,
} from './dto/check.dto';

@ApiTags('checks')
@ApiBearerAuth()
@Roles(Role.CAREGIVER)
@Controller('babies/:babyId')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  /** Questions for a routine or unwell check (FR-CHK-02/03). */
  @Get('check-plan')
  plan(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() q: CheckPlanQuery,
  ) {
    return this.checks.plan(user.id, babyId, q);
  }

  /** Record a check and get the traffic-light result immediately. 200 for a repeated clientRef. */
  @Post('observations')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Body() dto: CreateObservationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { duplicate, ...result } = await this.checks.create(user.id, babyId, dto);
    res.status(duplicate ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Get('observations')
  list(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() q: ListObservationsQuery,
  ) {
    return this.checks.list(user.id, babyId, q);
  }

  @Get('observations/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.checks.get(user.id, babyId, id);
  }

  @Post('observations/:id/photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  photo(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.checks.attachPhoto(user.id, babyId, id, file);
  }

  @Get('rechecks')
  rechecks(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() q: RechecksQuery,
  ) {
    return this.checks.rechecks(user.id, babyId, q.status);
  }
}
