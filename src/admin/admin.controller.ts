import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReviewClinicianDto } from '../clinicians/dto/clinician.dto';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JobStatus, PayoutStatus, Role, VerificationStatus } from '../generated/prisma/enums';
import { AdminService } from './admin.service';

class CliniciansQuery {
  @IsOptional() @IsEnum(VerificationStatus) status?: VerificationStatus;
}
class UserPatchDto {
  @IsBoolean() isActive: boolean;
}
class PayoutsQuery {
  @IsOptional() @IsEnum(PayoutStatus) status?: PayoutStatus;
}
class MarkPaidDto {
  @IsString() @MaxLength(100) reference: string;
}
class JobsQuery {
  @IsOptional() @IsEnum(JobStatus) status?: JobStatus;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Clinicians by verification status, with documents behind signed links (FR-ADM-01). */
  @Get('clinicians')
  clinicians(@Query() q: CliniciansQuery) {
    return this.admin.clinicians(q.status);
  }

  @Post('clinicians/:id/review')
  review(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewClinicianDto,
  ) {
    return this.admin.review(admin.id, id, dto);
  }

  @Patch('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserPatchDto) {
    return this.admin.setUserActive(id, dto.isActive);
  }

  @Get('payouts')
  payouts(@Query() q: PayoutsQuery) {
    return this.admin.payouts(q.status);
  }

  @Post('payouts/:id/mark-paid')
  markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) {
    return this.admin.markPayoutPaid(id, dto.reference);
  }

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('jobs')
  jobs(@Query() q: JobsQuery) {
    return this.admin.jobs(q.status);
  }
}
