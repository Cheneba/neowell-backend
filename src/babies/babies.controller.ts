import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { BabiesService } from './babies.service';
import { CreateBabyDto, UpdateBabyDto } from './dto/baby.dto';

@ApiTags('babies')
@ApiBearerAuth()
@Roles(Role.CAREGIVER)
@Controller('babies')
export class BabiesController {
  constructor(private readonly babies: BabiesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBabyDto) {
    return this.babies.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.babies.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.babies.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBabyDto,
  ) {
    return this.babies.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.babies.remove(user.id, id);
  }

  /** How many checks this baby needs per day (depends on age) and how many are still due. */
  @Get(':id/check-schedule')
  checkSchedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.babies.checkSchedule(user.id, id);
  }
}
