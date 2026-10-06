import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { GrowthService } from './growth.service';
import { CreateMeasurementDto, ListQuery } from './measurement.dto';

@ApiTags('growth')
@ApiBearerAuth()
@Roles(Role.CAREGIVER)
@Controller('babies/:babyId')
export class GrowthController {
  constructor(private readonly growth: GrowthService) {}

  /** Record new weight / length / HC, e.g. after a hospital visit (FR-MEAS-01). */
  @Post('measurements')
  add(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Body() dto: CreateMeasurementDto,
  ) {
    return this.growth.add(user.id, babyId, dto);
  }

  @Get('measurements')
  list(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() q: ListQuery,
  ) {
    return this.growth.list(user.id, babyId, q.limit);
  }

  /** Latest measurements with WHO z-scores and flags (FR-MEAS-04/05). */
  @Get('growth')
  get(@CurrentUser() user: AuthUser, @Param('babyId', ParseUUIDPipe) babyId: string) {
    return this.growth.forCaregiver(user.id, babyId);
  }
}
