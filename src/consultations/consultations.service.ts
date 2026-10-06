import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BabiesService } from '../babies/babies.service';
import {
  clinicianDisplayName,
  isAvailableNow,
  presentPublicClinician,
} from '../clinicians/clinician-presenter';
import { AuthUser } from '../common/auth-user';
import { Env } from '../config/env';
import { FilesService } from '../files/files.service';
import { Consultation, Prisma } from '../generated/prisma/client';
import {
  ConsultationMedium,
  ConsultationStatus,
  ConsultationTiming,
  MessageKind,
  PaymentKind,
  PaymentStatus,
  Role,
  VerificationStatus,
} from '../generated/prisma/enums';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentGateway } from '../payments/payment-gateway';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { BookConsultationDto, PayDto } from './dto/consultation.dto';
import { CONSULTATION_SLOT_MINUTES, fitsAvailability } from './scheduling';
import { ConsultationAction, refundOnCancel, transition } from './transitions';

export const ACTIVE: ConsultationStatus[] = ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS'];
export const UNPAID_TIMEOUT_MIN = 30;
export const ASAP_ACCEPT_MIN = 15;
export const CHAT_OPEN_AFTER_COMPLETION_H = 24;
export const CALL_OPENS_BEFORE_MIN = 10;

const MEDIUM_LABEL = { CHAT: 'Chat', AUDIO: 'Audio call', VIDEO: 'Video call' };

const detailInclude = {
  baby: true,
  caregiver: { select: { id: true, firstName: true, lastName: true } },
  clinician: { include: { user: { select: { firstName: true, lastName: true } } } },
  referral: { include: { facility: { include: { departments: true } } } },
  drugChart: { include: { items: true } },
  review: true,
} satisfies Prisma.ConsultationInclude;
type Detail = Prisma.ConsultationGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class ConsultationsService implements OnModuleInit {
  private readonly logger = new Logger(ConsultationsService.name);
  private readonly commissionPercent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
    private readonly reports: ReportsService,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly gateway: PaymentGateway,
    config: ConfigService<Env, true>,
  ) {
    this.commissionPercent = config.get('PLATFORM_COMMISSION_PERCENT', { infer: true });
  }

  onModuleInit() {
    this.jobs.register('payment.status', (p) => this.pollPayment(p.paymentId as string));
    this.jobs.register('payment.refund', (p) => this.refund(p.consultationId as string));
  }

  // ── Booking (FR-CONS-01/02/05) ─────────────────────────────

  async book(caregiverId: string, dto: BookConsultationDto) {
    const [baby, caregiver, clinician] = await Promise.all([
      this.babies.findOwned(caregiverId, dto.babyId),
      this.prisma.user.findUniqueOrThrow({ where: { id: caregiverId } }),
      this.prisma.clinicianProfile.findFirst({
        where: {
          id: dto.clinicianId,
          verificationStatus: VerificationStatus.VERIFIED,
          user: { isActive: true },
        },
        include: { availability: true },
      }),
    ]);
    if (!clinician) throw new NotFoundException('Clinician not found');
    if (!caregiver.consentClinicianShareAt) {
      throw new ForbiddenException({
        code: 'CONSENT_REQUIRED',
        message: 'Consent to share data with clinicians is required to book a consultation',
      });
    }
    if (dto.recordingConsent && !caregiver.consentRecordingAt) {
      throw new ForbiddenException({
        code: 'CONSENT_REQUIRED',
        message: 'Recording consent must be granted in settings first',
      });
    }
    const fee = {
      CHAT: clinician.offersChat && clinician.feeChatXaf,
      AUDIO: clinician.offersAudio && clinician.feeAudioXaf,
      VIDEO: clinician.offersVideo && clinician.feeVideoXaf,
    }[dto.medium];
    if (fee === false || fee == null)
      throw new BadRequestException('This clinician does not offer that medium');
    if (dto.observationId) {
      const ok = await this.prisma.observation.count({
        where: { id: dto.observationId, babyId: baby.id },
      });
      if (!ok) throw new BadRequestException('Unknown observationId');
    }

    const now = new Date();
    let scheduledAt: Date;
    if (dto.timing === ConsultationTiming.ASAP) {
      if (!isAvailableNow(clinician, now))
        throw new BadRequestException('Clinician is not available now');
      scheduledAt = now;
    } else {
      if (!dto.scheduledAt)
        throw new BadRequestException('scheduledAt is required for a scheduled consultation');
      scheduledAt = new Date(dto.scheduledAt);
      if (scheduledAt.getTime() < now.getTime() + 15 * 60_000) {
        throw new BadRequestException('scheduledAt must be at least 15 minutes from now');
      }
      if (!fitsAvailability(scheduledAt, clinician.availability)) {
        throw new BadRequestException('Clinician is not available at that time');
      }
    }

    const commission = Math.round((fee * this.commissionPercent) / 100);
    const slotMs = CONSULTATION_SLOT_MINUTES * 60_000;
    const create = this.prisma.$transaction(
      async (tx) => {
        if (dto.timing !== ConsultationTiming.ASAP) {
          const clash = await tx.consultation.findFirst({
            where: {
              clinicianId: clinician.id,
              OR: [
                { status: { in: ACTIVE } },
                {
                  status: 'AWAITING_PAYMENT',
                  createdAt: { gt: new Date(now.getTime() - UNPAID_TIMEOUT_MIN * 60_000) },
                },
              ],
              scheduledAt: {
                gt: new Date(scheduledAt.getTime() - slotMs),
                lt: new Date(scheduledAt.getTime() + slotMs),
              },
            },
          });
          if (clash) throw new ConflictException('That slot is already booked');
        }
        return tx.consultation.create({
          data: {
            babyId: baby.id,
            caregiverId,
            clinicianId: clinician.id,
            observationId: dto.observationId,
            medium: dto.medium,
            timing: dto.timing,
            scheduledAt,
            reason: dto.reason,
            preConsultChecklist: (dto.preConsultChecklist ?? undefined) as
              Prisma.InputJsonValue | undefined,
            recordingConsent: dto.recordingConsent ?? false,
            feeXaf: fee,
            commissionXaf: commission,
            clinicianEarningXaf: fee - commission,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    let consultation: Consultation;
    try {
      consultation = await create;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('That slot is already booked');
      }
      throw e;
    }
    return this.get({ id: caregiverId, role: Role.CAREGIVER }, consultation.id);
  }

  // ── Payment (FR-CONS-03, FR-PAY) ───────────────────────────

  async pay(caregiverId: string, id: string, dto: PayDto) {
    const c = await this.prisma.consultation.findFirst({ where: { id, caregiverId } });
    if (!c) throw new NotFoundException('Consultation not found');
    if (c.status !== ConsultationStatus.AWAITING_PAYMENT)
      throw new ConflictException('This consultation does not need payment');
    const pending = await this.prisma.payment.findFirst({
      where: { consultationId: id, kind: PaymentKind.COLLECTION, status: PaymentStatus.PENDING },
    });
    if (pending)
      return {
        paymentId: pending.id,
        status: pending.status,
        message: 'Approve the payment on your phone',
      };

    const payment = await this.prisma.payment.create({
      data: {
        consultationId: id,
        provider: dto.provider,
        payerPhone: dto.payerPhone,
        amountXaf: c.feeXaf,
        status: PaymentStatus.PENDING,
      },
    });
    try {
      const result = await this.gateway.collect({
        paymentId: payment.id,
        amountXaf: c.feeXaf,
        payerPhone: dto.payerPhone,
        operator: dto.provider,
        description: `NeoWell consultation ${c.id.slice(0, 8)}`,
      });
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { externalRef: result.externalRef },
        }),
        this.prisma.consultation.update({
          where: { id },
          data: { paymentStatus: PaymentStatus.PENDING },
        }),
      ]);
      await this.jobs.enqueue(
        'payment.status',
        { paymentId: payment.id },
        { runAt: new Date(Date.now() + this.gateway.firstPollDelayMs) },
      );
      if (result.status !== 'PENDING')
        await this.applyPaymentResult(payment.id, result.status, result.reason);
    } catch (e) {
      await this.applyPaymentResult(
        payment.id,
        'FAILED',
        e instanceof Error ? e.message : 'Payment could not start',
      );
      throw new BadRequestException('Payment could not be started. Please try again.');
    }
    return {
      paymentId: payment.id,
      status: PaymentStatus.PENDING,
      message: 'Approve the payment on your phone',
    };
  }

  /** Q5: ask the gateway for the payment status (webhook backup). */
  async pollPayment(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.status !== PaymentStatus.PENDING || !p.externalRef) return { skipped: true };
    const r = await this.gateway.status({ externalRef: p.externalRef, payerPhone: p.payerPhone });
    if (r.status === 'PENDING') {
      if (Date.now() - p.createdAt.getTime() > 2 * 60 * 60_000)
        return this.applyPaymentResult(p.id, 'FAILED', 'Timed out');
      throw new Error('Payment still pending'); // retried with backoff
    }
    return this.applyPaymentResult(p.id, r.status, r.reason);
  }

  /** Single place where payment results are applied — from webhooks, polls or the gateway. Idempotent. */
  async applyPaymentResult(paymentId: string, status: 'SUCCESSFUL' | 'FAILED', reason?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { consultation: true },
    });
    if (!payment || payment.status !== PaymentStatus.PENDING) return { ignored: true };
    const c = payment.consultation;

    if (payment.kind === PaymentKind.REFUND) {
      const ok = status === 'SUCCESSFUL';
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: ok ? PaymentStatus.REFUNDED : PaymentStatus.FAILED,
            failureReason: reason,
          },
        });
        await tx.consultation.update({
          where: { id: c.id },
          data: { paymentStatus: ok ? PaymentStatus.REFUNDED : PaymentStatus.REFUND_PENDING },
        });
        if (ok)
          await this.notifications.notify(
            {
              userId: c.caregiverId,
              type: 'REFUND_COMPLETED',
              params: { amount: payment.amountXaf },
              data: { url: `/consultation/${c.id}` },
            },
            tx,
          );
      });
      if (!ok) throw new Error(`Refund failed: ${reason ?? 'unknown'}`);
      return { refunded: true };
    }

    if (status === 'FAILED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, failureReason: reason },
        });
        await tx.consultation.update({
          where: { id: c.id },
          data: { paymentStatus: PaymentStatus.FAILED },
        });
        await this.notifications.notify(
          { userId: c.caregiverId, type: 'PAYMENT_FAILED', data: { url: `/consultation/${c.id}` } },
          tx,
        );
      });
      return { paid: false };
    }

    // Success: the clinician sees the request now, with a fresh pre-visit summary (FR-CONS-06).
    const summary = await this.reports.summary(c.babyId, 7);
    const baby = summary.baby;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });
      const moved = await tx.consultation.updateMany({
        where: { id: c.id, status: ConsultationStatus.AWAITING_PAYMENT },
        data: {
          status: ConsultationStatus.REQUESTED,
          paymentStatus: PaymentStatus.PAID,
          acceptDeadline:
            c.timing === ConsultationTiming.ASAP
              ? new Date(now.getTime() + ASAP_ACCEPT_MIN * 60_000)
              : c.scheduledAt,
          previsitSummary: summary as unknown as Prisma.InputJsonValue,
        },
      });
      if (moved.count === 0) {
        // Paid after the booking was cancelled: give the money back.
        await tx.consultation.update({
          where: { id: c.id },
          data: { paymentStatus: PaymentStatus.PAID },
        });
        await this.jobs.enqueue('payment.refund', { consultationId: c.id }, { tx, maxAttempts: 8 });
        return;
      }
      await tx.message.create({
        data: { consultationId: c.id, kind: MessageKind.REPORT, body: '7-day summary' },
      });
      const clinician = await tx.clinicianProfile.findUniqueOrThrow({
        where: { id: c.clinicianId },
      });
      await this.notifications.notify(
        {
          userId: clinician.userId,
          type: 'CONSULT_REQUESTED',
          params: { baby: baby.displayName, medium: MEDIUM_LABEL[c.medium] },
          data: { url: `/consultation/${c.id}` },
          sms: true,
        },
        tx,
      );
    });
    return { paid: true };
  }

  /** Q4: refund a paid consultation to the payer's number. */
  async refund(consultationId: string) {
    const c = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: { payments: true },
    });
    if (!c) return { skipped: true };
    if (c.paymentStatus === PaymentStatus.REFUNDED) return { skipped: true };
    const collection = c.payments.find(
      (p) => p.kind === PaymentKind.COLLECTION && p.status === PaymentStatus.PAID,
    );
    if (!collection) return { skipped: true, reason: 'nothing paid' };
    let refundRow = c.payments.find(
      (p) => p.kind === PaymentKind.REFUND && p.status === PaymentStatus.PENDING,
    );
    if (!refundRow) {
      refundRow = await this.prisma.payment.create({
        data: {
          consultationId: c.id,
          kind: PaymentKind.REFUND,
          provider: collection.provider,
          payerPhone: collection.payerPhone,
          amountXaf: collection.amountXaf,
          status: PaymentStatus.PENDING,
        },
      });
      await this.prisma.consultation.update({
        where: { id: c.id },
        data: { paymentStatus: PaymentStatus.REFUND_PENDING },
      });
    }
    // A refund already sent is only polled — never sent twice.
    if (refundRow.externalRef) {
      const r = await this.gateway.status({
        externalRef: refundRow.externalRef,
        payerPhone: refundRow.payerPhone,
      });
      if (r.status === 'PENDING') throw new Error('Refund pending');
      return this.applyPaymentResult(refundRow.id, r.status, r.reason);
    }
    const result = await this.gateway.refund({
      originalRef: collection.externalRef ?? collection.id,
      amountXaf: collection.amountXaf,
      payerPhone: collection.payerPhone,
    });
    await this.prisma.payment.update({
      where: { id: refundRow.id },
      data: { externalRef: result.externalRef },
    });
    if (result.status === 'PENDING') throw new Error('Refund pending'); // polled on retry
    return this.applyPaymentResult(refundRow.id, result.status, result.reason);
  }

  // ── Lifecycle (FR-CONS-04/10) ──────────────────────────────

  async act(
    user: AuthUser,
    id: string,
    action: ConsultationAction,
    body: { reason?: string; clinicianNotes?: string; diagnosisSummary?: string } = {},
  ) {
    const c = await this.findForParticipant(user, id);
    const to = transition(action, c.status, user.role);
    if (!to) throw new ConflictException(`Cannot ${action} a consultation that is ${c.status}`);
    const now = new Date();
    if (action === 'no-show' && c.scheduledAt > now)
      throw new ConflictException('The consultation has not started yet');
    if (
      action === 'start' &&
      c.scheduledAt.getTime() - now.getTime() > CALL_OPENS_BEFORE_MIN * 60_000
    ) {
      throw new ConflictException('Too early to start');
    }

    const refund =
      (action === 'decline' ||
        (action === 'cancel' && refundOnCancel(c.status, user.role, c.scheduledAt, now))) &&
      c.paymentStatus === PaymentStatus.PAID;
    const data: Prisma.ConsultationUpdateManyMutationInput = { status: to };
    if (action === 'accept' && c.medium !== ConsultationMedium.CHAT) data.roomName = `nw-${c.id}`;
    if (action === 'start') data.startedAt = now;
    if (action === 'complete') {
      data.endedAt = now;
      data.startedAt = c.startedAt ?? now;
      data.clinicianNotes = body.clinicianNotes;
      data.diagnosisSummary = body.diagnosisSummary;
    }
    if (action === 'cancel' || action === 'decline') {
      data.cancelledById = user.id;
      data.cancelReason = body.reason;
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.consultation.updateMany({
        where: { id: c.id, status: c.status },
        data,
      });
      if (count === 0) throw new ConflictException('Consultation was updated concurrently; retry');
      if (refund)
        await this.jobs.enqueue('payment.refund', { consultationId: c.id }, { tx, maxAttempts: 8 });
      const systemText: Partial<Record<ConsultationAction, string>> = {
        accept: 'CONFIRMED',
        start: 'STARTED',
        complete: 'COMPLETED',
        cancel: 'CANCELLED',
        decline: 'DECLINED',
        'no-show': 'NO_SHOW',
      };
      if (systemText[action])
        await tx.message.create({
          data: { consultationId: c.id, kind: MessageKind.SYSTEM, body: systemText[action] },
        });
      await this.notifyChange(tx, c, action, user);
    });
    return this.get(user, id);
  }

  private async notifyChange(
    tx: Prisma.TransactionClient,
    c: Detail,
    action: ConsultationAction,
    actor: AuthUser,
  ) {
    const url = `/consultation/${c.id}`;
    const babyName = (await this.babies.presentById(c.babyId)).displayName;
    const params = { baby: babyName, doctor: clinicianDisplayName(c.clinician) };
    if (action === 'accept')
      await this.notifications.notify(
        { userId: c.caregiverId, type: 'CONSULT_CONFIRMED', params, data: { url }, sms: true },
        tx,
      );
    if (action === 'decline')
      await this.notifications.notify(
        { userId: c.caregiverId, type: 'CONSULT_DECLINED', params, data: { url } },
        tx,
      );
    if (action === 'cancel') {
      const other =
        actor.role === Role.CAREGIVER
          ? c.status === ConsultationStatus.AWAITING_PAYMENT
            ? null
            : c.clinician.userId
          : c.caregiverId;
      if (other)
        await this.notifications.notify(
          { userId: other, type: 'CONSULT_CANCELLED', params, data: { url } },
          tx,
        );
    }
  }

  // ── Scheduled work (docs/05 J2, J3) ────────────────────────

  /** J2: cancel unpaid bookings, expire unanswered requests (with refund). */
  async expireDue(now = new Date()) {
    const unpaid = await this.prisma.consultation.updateMany({
      where: {
        status: ConsultationStatus.AWAITING_PAYMENT,
        createdAt: { lt: new Date(now.getTime() - UNPAID_TIMEOUT_MIN * 60_000) },
        payments: { none: { status: PaymentStatus.PENDING } },
      },
      data: { status: ConsultationStatus.CANCELLED, cancelReason: 'Not paid in time' },
    });
    const overdue = await this.prisma.consultation.findMany({
      where: { status: ConsultationStatus.REQUESTED, acceptDeadline: { lt: now } },
      select: { id: true, caregiverId: true, babyId: true },
      take: 100,
    });
    let expired = 0;
    for (const c of overdue) {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.consultation.updateMany({
          where: { id: c.id, status: ConsultationStatus.REQUESTED },
          data: { status: ConsultationStatus.EXPIRED },
        });
        if (!count) return;
        expired++;
        await this.jobs.enqueue('payment.refund', { consultationId: c.id }, { tx, maxAttempts: 8 });
        const baby = await this.babies.presentById(c.babyId);
        await this.notifications.notify(
          {
            userId: c.caregiverId,
            type: 'CONSULT_EXPIRED',
            params: { baby: baby.displayName },
            data: { url: `/consultation/${c.id}` },
          },
          tx,
        );
      });
    }
    return { cancelledUnpaid: unpaid.count, expired };
  }

  /** J3: remind both parties 10 minutes before a confirmed consultation. */
  async remindStartingSoon(now = new Date()) {
    const soon = await this.prisma.consultation.findMany({
      where: {
        status: ConsultationStatus.CONFIRMED,
        reminderSentAt: null,
        scheduledAt: {
          lte: new Date(now.getTime() + 10 * 60_000),
          gte: new Date(now.getTime() - 30 * 60_000),
        },
      },
      include: { clinician: true },
      take: 100,
    });
    for (const c of soon) {
      const { count } = await this.prisma.consultation.updateMany({
        where: { id: c.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (!count) continue;
      const baby = await this.babies.presentById(c.babyId);
      const time = c.scheduledAt.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Douala',
      });
      for (const userId of [c.caregiverId, c.clinician.userId]) {
        await this.notifications.notify({
          userId,
          type: 'CONSULT_STARTING_SOON',
          params: { baby: baby.displayName, time },
          data: { url: `/consultation/${c.id}` },
          sms: true,
        });
      }
    }
    return soon.length;
  }

  /** J4: poll stale pending payments; time out very old ones. */
  async reconcilePayments(now = new Date()) {
    const stale = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        createdAt: { lt: new Date(now.getTime() - 3 * 60_000) },
      },
      select: { id: true },
      take: 100,
    });
    for (const p of stale)
      await this.jobs.enqueue('payment.status', { paymentId: p.id }, { maxAttempts: 1 });
    return stale.length;
  }

  // ── Reading ────────────────────────────────────────────────

  async list(user: AuthUser, scope?: 'active' | 'past', limit = 50) {
    const where: Prisma.ConsultationWhereInput = await this.participantFilter(user);
    const activeStatuses: ConsultationStatus[] = ['AWAITING_PAYMENT', ...ACTIVE];
    if (scope === 'active') where.status = { in: activeStatuses };
    if (scope === 'past') where.status = { notIn: activeStatuses };
    if (user.role === Role.CLINICIAN)
      where.status = { ...(where.status as object), not: 'AWAITING_PAYMENT' };
    const rows = await this.prisma.consultation.findMany({
      where,
      include: detailInclude,
      orderBy: { scheduledAt: 'desc' },
      take: limit,
    });
    const unread = await this.unreadCounts(
      user.id,
      rows.map((r) => r.id),
    );
    return Promise.all(rows.map((r) => this.present(r, user, unread.get(r.id) ?? 0, false)));
  }

  async get(user: AuthUser, id: string) {
    const c = await this.findForParticipant(user, id);
    if (user.role === Role.CLINICIAN) {
      // FR-AUD-02: clinician access to a baby's data is audited.
      await this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'READ consultation',
          entityType: 'Consultation',
          entityId: id,
        },
      });
    }
    const unread = await this.unreadCounts(user.id, [id]);
    return this.present(c, user, unread.get(id) ?? 0, true);
  }

  /** Live 7-day summary for the clinician (FR-CONS-06). */
  async liveSummary(user: AuthUser, id: string, days: 3 | 7) {
    const c = await this.findForParticipant(user, id);
    if (c.status === ConsultationStatus.AWAITING_PAYMENT)
      throw new NotFoundException('Consultation not found');
    return this.reports.summary(c.babyId, days);
  }

  async findForParticipant(user: AuthUser, id: string): Promise<Detail> {
    const c = await this.prisma.consultation.findFirst({
      where: { id, ...(await this.participantFilter(user)) },
      include: detailInclude,
    });
    // Clinicians only see a consultation once it is paid.
    if (!c || (user.role === Role.CLINICIAN && c.status === ConsultationStatus.AWAITING_PAYMENT)) {
      throw new NotFoundException('Consultation not found');
    }
    return c;
  }

  private async participantFilter(user: AuthUser): Promise<Prisma.ConsultationWhereInput> {
    if (user.role === Role.CAREGIVER) return { caregiverId: user.id };
    if (user.role === Role.CLINICIAN) {
      const profile = await this.prisma.clinicianProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw new ForbiddenException('Clinician profile not registered');
      return { clinicianId: profile.id };
    }
    throw new ForbiddenException();
  }

  private async unreadCounts(userId: string, ids: string[]) {
    const rows = await this.prisma.message.groupBy({
      by: ['consultationId'],
      where: {
        consultationId: { in: ids },
        readAt: null,
        kind: { in: ['TEXT', 'IMAGE'] },
        NOT: { senderId: userId },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.consultationId, r._count._all]));
  }

  chatOpen(c: Pick<Consultation, 'status' | 'endedAt'>, now = new Date()): boolean {
    if (c.status === ConsultationStatus.CONFIRMED || c.status === ConsultationStatus.IN_PROGRESS)
      return true;
    return (
      c.status === ConsultationStatus.COMPLETED &&
      !!c.endedAt &&
      now.getTime() - c.endedAt.getTime() < CHAT_OPEN_AFTER_COMPLETION_H * 3_600_000
    );
  }

  canJoinCall(
    c: Pick<Consultation, 'status' | 'medium' | 'scheduledAt'>,
    now = new Date(),
  ): boolean {
    return (
      c.medium !== ConsultationMedium.CHAT &&
      (c.status === ConsultationStatus.CONFIRMED || c.status === ConsultationStatus.IN_PROGRESS) &&
      now.getTime() >= c.scheduledAt.getTime() - CALL_OPENS_BEFORE_MIN * 60_000
    );
  }

  private async present(c: Detail, user: AuthUser, unreadCount: number, detail: boolean) {
    const baby = await this.babies.presentById(c.babyId);
    const isClinician = user.role === Role.CLINICIAN;
    return {
      id: c.id,
      status: c.status,
      medium: c.medium,
      timing: c.timing,
      scheduledAt: c.scheduledAt,
      acceptDeadline: c.acceptDeadline,
      reason: c.reason,
      feeXaf: c.feeXaf,
      paymentStatus: c.paymentStatus,
      ...(isClinician
        ? { commissionXaf: c.commissionXaf, clinicianEarningXaf: c.clinicianEarningXaf }
        : {}),
      baby: {
        id: baby.id,
        displayName: baby.displayName,
        givenName: baby.givenName,
        ageDays: baby.ageDays,
        sex: baby.sex,
        isHighRisk: baby.isHighRisk,
        riskFactors: baby.riskFactors,
      },
      clinician: presentPublicClinician(c.clinician, this.files),
      // Clinicians see the mother's name (needed for referrals) but never her phone (FR-CONS-08).
      ...(isClinician
        ? { caregiver: { firstName: c.caregiver.firstName, lastName: c.caregiver.lastName } }
        : {}),
      observationId: c.observationId,
      preConsultChecklist: c.preConsultChecklist,
      ...(detail ? { previsitSummary: c.previsitSummary } : {}),
      referral: c.referral
        ? {
            id: c.referral.id,
            code: c.referral.code,
            urgency: c.referral.urgency,
            reason: c.referral.reason,
            facilityName: c.referral.facilityName,
            facility: c.referral.facility
              ? {
                  id: c.referral.facility.id,
                  name: c.referral.facility.name,
                  mainPhone: c.referral.facility.mainPhone,
                  departments: c.referral.facility.departments,
                }
              : null,
            createdAt: c.referral.createdAt,
          }
        : null,
      drugChart: c.drugChart,
      review: c.review ? { rating: c.review.rating, comment: c.review.comment } : null,
      clinicianNotes: c.clinicianNotes,
      diagnosisSummary: c.diagnosisSummary,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      cancelReason: c.cancelReason,
      chatOpen: this.chatOpen(c),
      canJoinCall: this.canJoinCall(c),
      unreadCount,
      createdAt: c.createdAt,
    };
  }
}
