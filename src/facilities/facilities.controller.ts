import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { CreateFacilityDto, NearbyFacilitiesQuery } from './dto/facility.dto';
import { FacilitiesService } from './facilities.service';

@ApiTags('facilities')
@ApiBearerAuth()
@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilities: FacilitiesService) {}

  /** Nearest facilities able to care for newborns, with department helplines. */
  @Get('nearby')
  nearby(@Query() query: NearbyFacilitiesQuery) {
    return this.facilities.nearby(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.facilities.get(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateFacilityDto) {
    return this.facilities.create(dto);
  }
}
