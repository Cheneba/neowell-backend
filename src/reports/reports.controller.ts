import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BabiesService } from '../babies/babies.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Roles(Role.CAREGIVER)
@Controller('babies/:babyId/summary')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly babies: BabiesService,
  ) {}

  @Get()
  @ApiQuery({ name: 'days', enum: [3, 7], required: false })
  async summary(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query('days') days?: string,
  ) {
    if (days !== undefined && days !== '3' && days !== '7') {
      throw new BadRequestException('days must be 3 or 7');
    }
    await this.babies.findOwned(user.id, babyId);
    return this.reports.summary(babyId, days === '3' ? 3 : 7);
  }
}
