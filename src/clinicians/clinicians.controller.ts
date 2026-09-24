import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClinicianDocumentType, Role } from '../generated/prisma/enums';
import { CliniciansService } from './clinicians.service';
import {
  RegisterClinicianDto,
  ReviewClinicianDto,
  SetAvailabilityDto,
  UpdateClinicianDto,
  UploadDocumentDto,
} from './dto/clinician.dto';

@ApiTags('clinicians')
@ApiBearerAuth()
@Controller('clinicians')
export class CliniciansController {
  constructor(private readonly clinicians: CliniciansService) {}

  /** Verified clinicians available for teleconsultation. */
  @Get()
  list() {
    return this.clinicians.listVerified();
  }

  // Static routes are declared before `:id` so they are not captured by it.

  @Post('me')
  @Roles(Role.CLINICIAN)
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterClinicianDto) {
    return this.clinicians.register(user.id, dto);
  }

  @Get('me')
  @Roles(Role.CLINICIAN)
  me(@CurrentUser() user: AuthUser) {
    return this.clinicians.myProfile(user.id);
  }

  @Patch('me')
  @Roles(Role.CLINICIAN)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateClinicianDto) {
    return this.clinicians.update(user.id, dto);
  }

  /** Upload a medical license, degree or proof of employment (PDF/JPEG/PNG). */
  @Post('me/documents')
  @Roles(Role.CLINICIAN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'file'],
      properties: {
        type: { type: 'string', enum: Object.values(ClinicianDocumentType) },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.clinicians.uploadDocument(user.id, dto.type, file);
  }

  @Put('me/availability')
  @Roles(Role.CLINICIAN)
  setAvailability(@CurrentUser() user: AuthUser, @Body() dto: SetAvailabilityDto) {
    return this.clinicians.setAvailability(user.id, dto);
  }

  @Get('review-queue')
  @Roles(Role.ADMIN)
  reviewQueue() {
    return this.clinicians.reviewQueue();
  }

  @Post(':id/review')
  @Roles(Role.ADMIN)
  review(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewClinicianDto,
  ) {
    return this.clinicians.review(admin.id, id, dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinicians.getVerified(id);
  }
}
