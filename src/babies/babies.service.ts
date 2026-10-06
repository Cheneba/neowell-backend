import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Baby, Facility, User } from '../generated/prisma/client';
import { CareStatus, MeasurementSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CHECK_TIMES, checksPerDay } from '../triage/check-schedule';
import {
  ageDays,
  BabyLike,
  birthWeightCategory,
  correctedAgeDays,
  displayNames,
  isHighRisk,
  NAMING_AGE_DAYS,
  riskFactors,
  termStatus,
} from './baby-facts';
import { CreateBabyDto, UpdateBabyDto } from './dto/baby.dto';

type BabyRow = Baby & { birthFacility?: Pick<Facility, 'id' | 'name'> | null };

export const toBabyLike = (b: Baby): BabyLike => ({
  id: b.id,
  givenName: b.givenName,
  dateOfBirth: b.dateOfBirth,
  sex: b.sex,
  gestationalAgeWeeks: b.gestationalAgeWeeks,
  birthWeightGrams: b.birthWeightGrams,
  birthLengthCm: b.birthLengthCm == null ? null : Number(b.birthLengthCm),
  birthHeadCircumferenceCm:
    b.birthHeadCircumferenceCm == null ? null : Number(b.birthHeadCircumferenceCm),
  createdAt: b.createdAt,
});

@Injectable()
export class BabiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(caregiverId: string, dto: CreateBabyDto) {
    const caregiver = await this.prisma.user.findUniqueOrThrow({ where: { id: caregiverId } });
    if (!caregiver.firstName?.trim() || !caregiver.lastName?.trim()) {
      throw new ForbiddenException({
        code: 'PROFILE_INCOMPLETE',
        message: 'Add your first and last name before adding a baby',
      });
    }
    const dateOfBirth = new Date(dto.dateOfBirth);
    const dischargeDate = dto.dischargeDate ? new Date(dto.dischargeDate) : undefined;
    this.assertDates(dateOfBirth, dischargeDate);
    await this.assertFacility(dto.birthFacilityId);

    const baby = await this.prisma.$transaction(async (tx) => {
      const created = await tx.baby.create({
        data: {
          ...dto,
          givenName: dto.givenName?.trim() || null,
          dateOfBirth,
          dischargeDate,
          caregiverId,
        },
      });
      // FR-MEAS-02: birth values are the first measurement.
      await tx.measurement.create({
        data: {
          babyId: created.id,
          measuredAt: dateOfBirth,
          weightGrams: dto.birthWeightGrams,
          lengthCm: dto.birthLengthCm,
          headCircumferenceCm: dto.birthHeadCircumferenceCm,
          source: MeasurementSource.BIRTH,
          recordedById: caregiverId,
        },
      });
      return created;
    });
    return this.get(caregiverId, baby.id);
  }

  async list(caregiverId: string) {
    const [caregiver, babies] = await this.loadFamily(caregiverId);
    return this.present(babies, caregiver);
  }

  async get(caregiverId: string, id: string) {
    const [caregiver, babies] = await this.loadFamily(caregiverId);
    const baby = babies.find((b) => b.id === id);
    if (!baby) throw new NotFoundException('Baby not found');
    return this.present(babies, caregiver).find((b) => b.id === id)!;
  }

  /** Presents any baby (e.g. for a clinician), computing the display name within its family. */
  async presentById(babyId: string) {
    const baby = await this.prisma.baby.findUniqueOrThrow({ where: { id: babyId } });
    const [caregiver, babies] = await this.loadFamily(baby.caregiverId);
    const all = babies.some((b) => b.id === babyId) ? babies : [...babies, baby];
    return this.present(all, caregiver).find((b) => b.id === babyId)!;
  }

  async update(caregiverId: string, id: string, dto: UpdateBabyDto) {
    const existing = await this.findOwned(caregiverId, id);
    const dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined;
    const dischargeDate = dto.dischargeDate ? new Date(dto.dischargeDate) : undefined;
    this.assertDates(
      dateOfBirth ?? existing.dateOfBirth,
      dischargeDate ?? existing.dischargeDate ?? undefined,
    );
    await this.assertFacility(dto.birthFacilityId);
    await this.prisma.baby.update({
      where: { id },
      data: {
        ...dto,
        givenName: dto.givenName === undefined ? undefined : dto.givenName.trim() || null,
        dateOfBirth,
        // Coming home starts home checks (FR-BABY-05).
        dischargeDate:
          dischargeDate ??
          (dto.careStatus === CareStatus.AT_HOME &&
          existing.careStatus !== CareStatus.AT_HOME &&
          !existing.dischargeDate
            ? new Date()
            : undefined),
      },
    });
    return this.get(caregiverId, id);
  }

  /** Soft delete; purged by the retention job. */
  async remove(caregiverId: string, id: string) {
    await this.findOwned(caregiverId, id);
    await this.prisma.baby.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Throws 404 unless the baby exists and belongs to this caregiver. */
  async findOwned(caregiverId: string, id: string): Promise<Baby> {
    const baby = await this.prisma.baby.findFirst({ where: { id, caregiverId, deletedAt: null } });
    if (!baby) throw new NotFoundException('Baby not found');
    return baby;
  }

  async checkSchedule(caregiverId: string, id: string, now = new Date()) {
    const baby = await this.findOwned(caregiverId, id);
    const perDay = checksPerDay(baby.dateOfBirth, now);
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [doneLast24h, pendingRecheck] = await Promise.all([
      this.prisma.observation.count({
        where: { babyId: id, observedAt: { gte: since, lte: now } },
      }),
      this.prisma.recheck.findFirst({
        where: { babyId: id, status: 'PENDING' },
        orderBy: { dueAt: 'asc' },
        select: { id: true, dueAt: true, reason: true },
      }),
    ]);
    const paused = baby.careStatus !== CareStatus.AT_HOME;
    return {
      checksPerDay: perDay,
      reminderTimes: paused ? [] : CHECK_TIMES[perDay],
      checksLast24h: doneLast24h,
      checksDue: paused ? 0 : Math.max(0, perDay - doneLast24h),
      paused,
      pausedReason: paused ? baby.careStatus : null,
      pendingRecheck,
    };
  }

  private async loadFamily(caregiverId: string): Promise<[User, BabyRow[]]> {
    return Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: caregiverId } }),
      this.prisma.baby.findMany({
        where: { caregiverId, deletedAt: null },
        orderBy: { dateOfBirth: 'desc' },
        include: { birthFacility: { select: { id: true, name: true } } },
      }),
    ]);
  }

  present(babies: BabyRow[], caregiver: Pick<User, 'lastName'>, now = new Date()) {
    const names = displayNames(babies.map(toBabyLike), caregiver.lastName, now);
    return babies.map((b) => {
      const like = toBabyLike(b);
      const factors = riskFactors(like);
      const days = ageDays(b.dateOfBirth, now);
      return {
        id: b.id,
        givenName: b.givenName,
        displayName: names.get(b.id)!,
        sex: b.sex,
        dateOfBirth: b.dateOfBirth,
        ageDays: days,
        correctedAgeDays: correctedAgeDays(b.dateOfBirth, b.gestationalAgeWeeks, now),
        gestationalAgeWeeks: b.gestationalAgeWeeks,
        termStatus: termStatus(b.gestationalAgeWeeks),
        birthWeightGrams: b.birthWeightGrams,
        birthWeightCategory: birthWeightCategory(b.birthWeightGrams),
        birthLengthCm: like.birthLengthCm,
        birthHeadCircumferenceCm: like.birthHeadCircumferenceCm,
        birthFacility: b.birthFacility ?? null,
        birthFacilityName: b.birthFacilityName,
        careStatus: b.careStatus,
        dischargeDate: b.dischargeDate,
        riskFactors: factors.map((code) => ({ code })),
        isHighRisk: isHighRisk(factors),
        needsName: days >= NAMING_AGE_DAYS && !b.givenName,
        createdAt: b.createdAt,
      };
    });
  }

  private assertDates(dob: Date, discharge?: Date) {
    if (dob > new Date()) throw new BadRequestException('dateOfBirth cannot be in the future');
    if (discharge && discharge < dob) {
      throw new BadRequestException('dischargeDate cannot be before dateOfBirth');
    }
  }

  private async assertFacility(id?: string) {
    if (id && !(await this.prisma.facility.findUnique({ where: { id } }))) {
      throw new BadRequestException('Unknown birthFacilityId');
    }
  }
}

export type PresentedBaby = ReturnType<BabiesService['present']>[number];
