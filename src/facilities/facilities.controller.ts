import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import {
  CreateFacilityDto,
  NearbyFacilitiesQuery,
  SearchFacilitiesQuery,
  UpdateFacilityDto,
} from './dto/facility.dto';
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

  /** Search by name (birth facility picker, referrals). */
  @Get()
  search(@Query() query: SearchFacilitiesQuery) {
    return this.facilities.search(query);
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

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFacilityDto) {
    return this.facilities.update(id, dto);
  }
}
