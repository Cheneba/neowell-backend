import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { UpdateConsentsDto, UpdateMeDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.update(user.id, dto);
  }

  @Put('consents')
  updateConsents(@CurrentUser() user: AuthUser, @Body() dto: UpdateConsentsDto) {
    return this.users.updateConsents(user.id, dto);
  }

  /** Download all your data as JSON (FR-ACC-03). */
  @Get('export')
  @Roles(Role.CAREGIVER)
  export(@CurrentUser() user: AuthUser) {
    return this.users.export(user.id);
  }

  /** Delete your account: access ends now, data is purged after 30 days (FR-ACC-04). */
  @Delete()
  @Roles(Role.CAREGIVER, Role.CLINICIAN)
  @HttpCode(HttpStatus.ACCEPTED)
  delete(@CurrentUser() user: AuthUser) {
    return this.users.requestDeletion(user.id);
  }
}
