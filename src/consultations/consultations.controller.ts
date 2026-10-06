import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { CallsService } from './calls.service';
import { CareService } from './care.service';
import { ConsultationsService } from './consultations.service';
import {
  BookConsultationDto,
  CompleteDto,
  DrugChartDto,
  ListConsultationsQuery,
  MessagesQuery,
  PayDto,
  ReadDto,
  ReasonDto,
  ReferralDto,
  ReviewDto,
  SendMessageDto,
  SummaryQuery,
} from './dto/consultation.dto';
import { MessagesService } from './messages.service';

type Id = string;

@ApiTags('consultations')
@ApiBearerAuth()
@Roles(Role.CAREGIVER, Role.CLINICIAN)
@Controller('consultations')
export class ConsultationsController {
  constructor(
    private readonly consultations: ConsultationsService,
    private readonly messages: MessagesService,
    private readonly calls: CallsService,
    private readonly care: CareService,
  ) {}

  /** Book (FR-CONS-01). The consultation starts AWAITING_PAYMENT. */
  @Post()
  @Roles(Role.CAREGIVER)
  book(@CurrentUser() user: AuthUser, @Body() dto: BookConsultationDto) {
    return this.consultations.book(user.id, dto);
  }

  /** Pay with MTN MoMo / Orange Money (FR-CONS-03). */
  @Post(':id/payments')
  @Roles(Role.CAREGIVER)
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: Id, @Body() dto: PayDto) {
    return this.consultations.pay(user.id, id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListConsultationsQuery) {
    return this.consultations.list(user, q.scope, q.limit);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: Id) {
    return this.consultations.get(user, id);
  }

  /** Live summary of the baby's checks for the clinician. */
  @Get(':id/summary')
  @Roles(Role.CLINICIAN)
  summary(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Query() q: SummaryQuery,
  ) {
    return this.consultations.liveSummary(user, id, q.days === '3' ? 3 : 7);
  }

  @Post(':id/accept')
  @Roles(Role.CLINICIAN)
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: Id) {
    return this.consultations.act(user, id, 'accept');
  }

  @Post(':id/decline')
  @Roles(Role.CLINICIAN)
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Body() dto: ReasonDto,
  ) {
    return this.consultations.act(user, id, 'decline', dto);
  }

  @Post(':id/start')
  @Roles(Role.CLINICIAN)
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: Id) {
    return this.consultations.act(user, id, 'start');
  }

  @Post(':id/complete')
  @Roles(Role.CLINICIAN)
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Body() dto: CompleteDto,
  ) {
    return this.consultations.act(user, id, 'complete', dto);
  }

  @Post(':id/no-show')
  @Roles(Role.CLINICIAN)
  @HttpCode(HttpStatus.OK)
  noShow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: Id) {
    return this.consultations.act(user, id, 'no-show');
  }

  /** Cancel; refunds follow FR-CONS-10. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Body() dto: ReasonDto,
  ) {
    return this.consultations.act(user, id, 'cancel', dto);
  }

  // ── Chat (FR-CONS-07/08) ───────────────────────────────────

  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Query() q: MessagesQuery,
  ) {
    return this.messages.list(user, id, q.after, q.limit);
  }

  @Post(':id/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.sendText(user, id, dto.body);
  }

  @Post(':id/messages/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  sendImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.messages.sendImage(user, id, file);
  }

  @Post(':id/messages/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: Id, @Body() dto: ReadDto) {
    return this.messages.markRead(user, id, dto.upToId);
  }

  // ── Call, referral, drug chart, review ─────────────────────

  /** Short-lived link to the secure call page (FR-CONS-09). */
  @Post(':id/call')
  @HttpCode(HttpStatus.OK)
  call(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: Id) {
    return this.calls.joinLink(user, id);
  }

  @Post(':id/referral')
  @Roles(Role.CLINICIAN)
  refer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Body() dto: ReferralDto,
  ) {
    return this.care.refer(user, id, dto);
  }

  @Post(':id/drug-chart')
  @Roles(Role.CLINICIAN)
  prescribe(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Body() dto: DrugChartDto,
  ) {
    return this.care.prescribe(user, id, dto);
  }

  @Post(':id/review')
  @Roles(Role.CAREGIVER)
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: Id,
    @Body() dto: ReviewDto,
  ) {
    return this.care.review(user, id, dto);
  }
}
