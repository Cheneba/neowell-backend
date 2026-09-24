import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { ConsultationsService } from './consultations.service';
import { BookConsultationDto, UpdateConsultationStatusDto } from './dto/consultation.dto';

@ApiTags('consultations')
@ApiBearerAuth()
@Roles(Role.CAREGIVER, Role.CLINICIAN)
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  /** Book a teleconsultation. A 7-day pre-visit summary is attached for the clinician. */
  @Post()
  @Roles(Role.CAREGIVER)
  book(@CurrentUser() user: AuthUser, @Body() dto: BookConsultationDto) {
    return this.consultations.book(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.consultations.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultations.get(user, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConsultationStatusDto,
  ) {
    return this.consultations.updateStatus(user, id, dto);
  }
}
