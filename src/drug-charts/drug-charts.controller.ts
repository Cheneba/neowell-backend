import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsOptional } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DoseStatus, Role } from '../generated/prisma/enums';
import { DrugChartsService } from './drug-charts.service';

class ActiveQuery {
  @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
}

class DoseDto {
  @IsDateString() scheduledFor: string;
  @IsEnum(DoseStatus) status: DoseStatus;
}

@ApiTags('medicines')
@ApiBearerAuth()
@Controller()
export class DrugChartsController {
  constructor(private readonly charts: DrugChartsService) {}

  @Get('babies/:babyId/drug-charts')
  @Roles(Role.CAREGIVER)
  forBaby(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() q: ActiveQuery,
  ) {
    return this.charts.forBaby(user.id, babyId, q.active === 'true');
  }

  @Get('drug-charts/:id')
  @Roles(Role.CAREGIVER, Role.CLINICIAN)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.charts.get(user, id);
  }

  /** Mark a scheduled dose as given or skipped (FR-DRUG-03). */
  @Post('drug-chart-items/:itemId/doses')
  @Roles(Role.CAREGIVER)
  dose(
    @CurrentUser() user: AuthUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: DoseDto,
  ) {
    return this.charts.logDose(user.id, itemId, new Date(dto.scheduledFor), dto.status);
  }
}
