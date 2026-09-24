import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BabiesService } from '../babies/babies.service';
import { AuthUser } from '../common/auth-user';
import { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { ConsultationStatus, Role, VerificationStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { BookConsultationDto, UpdateConsultationStatusDto } from './dto/consultation.dto';
import { CONSULTATION_SLOT_MINUTES, fitsAvailability } from './scheduling';
import { canTransition } from './transitions';

const ACTIVE: ConsultationStatus[] = [
  ConsultationStatus.REQUESTED,
  ConsultationStatus.CONFIRMED,
  ConsultationStatus.IN_PROGRESS,
];

@Injectable()
export class ConsultationsService {
  private readonly commissionPercent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
    private readonly reports: ReportsService,
    config: ConfigService<Env, true>,
  ) {
    this.commissionPercent = config.get('PLATFORM_COMMISSION_PERCENT', { infer: true });
  }

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

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date())
      throw new BadRequestException('scheduledAt must be in the future');
    if (!fitsAvailability(scheduledAt, clinician.availability)) {
      throw new BadRequestException('Clinician is not available at that time');
    }

    const slotMs = CONSULTATION_SLOT_MINUTES * 60_000;
    const previsitSummary = await this.reports.summary(baby.id, 7);
    const fee = clinician.consultationFeeXaf;

    // Serializable so two concurrent bookings cannot both take the same slot.
    const create = this.prisma.$transaction(
      async (tx) => {
        const clash = await tx.consultation.findFirst({
          where: {
            clinicianId: clinician.id,
            status: { in: ACTIVE },
            scheduledAt: {
              gt: new Date(scheduledAt.getTime() - slotMs),
              lt: new Date(scheduledAt.getTime() + slotMs),
            },
          },
        });
        if (clash) throw new ConflictException('That slot is already booked');

        return tx.consultation.create({
          data: {
            babyId: baby.id,
            caregiverId,
            clinicianId: clinician.id,
            type: dto.type,
            scheduledAt,
            reason: dto.reason,
            recordingConsent: dto.recordingConsent ?? false,
            feeXaf: fee,
            commissionXaf: Math.round((fee * this.commissionPercent) / 100),
            previsitSummary: previsitSummary as unknown as Prisma.InputJsonValue,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    try {
      return await create;
    } catch (e) {
      // P2034: serialization failure — a concurrent booking won the slot.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('That slot is already booked');
      }
      throw e;
    }
  }

  async list(user: AuthUser) {
    return this.prisma.consultation.findMany({
      where: await this.participantFilter(user),
      omit: { previsitSummary: true },
      include: {
        baby: { select: { id: true, name: true } },
        clinician: { select: { id: true, user: { select: { fullName: true } } } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    });
  }

  async get(user: AuthUser, id: string) {
    const c = await this.prisma.consultation.findFirst({
      where: { id, ...(await this.participantFilter(user)) },
      include: {
        baby: { select: { id: true, name: true, dateOfBirth: true } },
        clinician: { select: { id: true, user: { select: { fullName: true } } } },
        caregiver: { select: { fullName: true, phone: true } },
      },
    });
    if (!c) throw new NotFoundException('Consultation not found');
    return c;
  }

  async updateStatus(user: AuthUser, id: string, dto: UpdateConsultationStatusDto) {
    const c = await this.get(user, id);
    if (!canTransition(c.status, dto.status, user.role)) {
      throw new BadRequestException(`Cannot change status from ${c.status} to ${dto.status}`);
    }
    if (dto.clinicianNotes !== undefined && user.role !== Role.CLINICIAN) {
      throw new ForbiddenException('Only the clinician can add notes');
    }
    const { count } = await this.prisma.consultation.updateMany({
      where: { id, status: c.status },
      data: { status: dto.status, clinicianNotes: dto.clinicianNotes },
    });
    if (count === 0) throw new ConflictException('Consultation was updated concurrently; retry');
    return this.get(user, id);
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
}
