import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { MAX_VOICE_BYTES, VoiceService } from './voice.service';

@ApiTags('voice')
@ApiBearerAuth()
@Controller()
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  /** Record what is wrong in your own words (≤ 60 s). Transcribed in the background (FR-VOICE). */
  @Post('babies/:babyId/voice-notes')
  @Roles(Role.CAREGIVER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VOICE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  upload(
    @CurrentUser() user: AuthUser,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.voice.upload(user.id, babyId, file);
  }

  @Get('voice-notes/:id')
  @Roles(Role.CAREGIVER, Role.CLINICIAN)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.get(user, id);
  }
}
