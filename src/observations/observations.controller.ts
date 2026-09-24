import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { CreateObservationDto, ListObservationsQuery } from './dto/observation.dto';
import { ObservationsService } from './observations.service';

@ApiTags('observations')
@ApiBearerAuth()
@Roles(Role.CAREGIVER)
@Controller('babies/:babyId/observations')
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  /** Record a daily wellbeing check and get the traffic-light result immediately. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Body() dto: CreateObservationDto,
  ) {
    return this.observations.create(user.id, babyId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() query: ListObservationsQuery,
  ) {
    return this.observations.list(user.id, babyId, query);
  }
}
