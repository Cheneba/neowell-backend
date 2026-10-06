import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { sniffDocumentMime } from '../clinicians/file-type';
import { ConfigService } from '@nestjs/config';
import { BabiesService } from '../babies/babies.service';
import { ageDays as ageInDays } from '../babies/baby-facts';
import { Env } from '../config/env';
import { FilesService } from '../files/files.service';
import { Observation, Prisma } from '../generated/prisma/client';
import { CheckType, RecheckStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ageInHours } from '../triage/check-schedule';
import { assessRisk, RiskFinding } from '../triage/risk-engine';
import { CheckPlanQuery, CreateObservationDto, ListObservationsQuery } from './dto/check.dto';
import {
  QUESTION_BANK_VERSION,
  QUESTIONS,
  ROUTINE_ROTATING,
  routinePlan,
  unwellPlan,
} from './question-bank';

export const RECHECK_AFTER_MINUTES = 30;

@Injectable()
export class ChecksService {
  private readonly emergencyNumbers: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
    config: ConfigService<Env, true>,
  ) {
    this.emergencyNumbers = config
      .get('EMERGENCY_PHONE_NUMBERS', { infer: true })
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** FR-CHK-02/03: the questions for this check, in the caregiver's language. */
  async plan(caregiverId: string, babyId: string, q: CheckPlanQuery) {
    const [baby, user] = await Promise.all([
      this.babies.findOwned(caregiverId, babyId),
      this.prisma.user.findUniqueOrThrow({ where: { id: caregiverId } }),
    ]);
    const lang = q.lang ?? user.locale;
    const days = ageInDays(baby.dateOfBirth);
    if (q.type === CheckType.UNWELL) {
      return {
        type: q.type,
        version: QUESTION_BANK_VERSION,
        complaints: q.complaints ?? [],
        questions: unwellPlan(q.complaints ?? [], days, lang),
      };
    }
    // When was each rotating question last answered?
    const recent = await this.prisma.observation.findMany({
      where: { babyId },
      orderBy: { observedAt: 'desc' },
      take: 12,
    });
    const lastAnswered = new Map<string, Date>();
    for (const id of ROUTINE_ROTATING) {
      const field = QUESTIONS[id].field as keyof Observation;
      const hit = recent.find((o) => o[field] != null);
      if (hit) lastAnswered.set(field, hit.observedAt);
    }
    return {
      type: q.type,
      version: QUESTION_BANK_VERSION,
      complaints: [],
      questions: routinePlan(days, lastAnswered, lang),
    };
  }

  async create(caregiverId: string, babyId: string, dto: CreateObservationDto) {
    const [baby, user] = await Promise.all([
      this.babies.findOwned(caregiverId, babyId),
      this.prisma.user.findUniqueOrThrow({ where: { id: caregiverId } }),
    ]);
    if (!user.consentDataCollectionAt) {
      throw new ForbiddenException({
        code: 'CONSENT_REQUIRED',
        message: 'Data collection consent is required before recording checks',
      });
    }

    // FR-CHK-11: an offline re-send returns the stored check instead of duplicating it.
    if (dto.clientRef) {
      const existing = await this.prisma.observation.findUnique({
        where: { babyId_clientRef: { babyId, clientRef: dto.clientRef } },
        include: { rechecks: { where: { status: RecheckStatus.PENDING } } },
      });
      if (existing)
        return { duplicate: true, ...this.result(existing, existing.rechecks[0] ?? null) };
    }

    const now = new Date();
    const observedAt = dto.observedAt ? new Date(dto.observedAt) : now;
    if (observedAt.getTime() > now.getTime() + 5 * 60 * 1000) {
      throw new BadRequestException('observedAt cannot be in the future');
    }
    if (observedAt < baby.dateOfBirth)
      throw new BadRequestException('observedAt cannot be before the date of birth');

    const recheckOf = dto.recheckOfId
      ? await this.prisma.recheck.findFirst({ where: { id: dto.recheckOfId, babyId } })
      : null;
    if (dto.recheckOfId && !recheckOf) throw new BadRequestException('Unknown recheckOfId');
    if (dto.voiceNoteId) {
      const note = await this.prisma.voiceNote.findFirst({
        where: { id: dto.voiceNoteId, babyId, ownerId: caregiverId },
      });
      if (!note) throw new BadRequestException('Unknown voiceNoteId');
    }

    const assessment = assessRisk(
      dto,
      {
        ageHours: ageInHours(baby.dateOfBirth, observedAt),
        gestationalAgeWeeks: baby.gestationalAgeWeeks,
        birthWeightGrams: baby.birthWeightGrams,
      },
      undefined,
      { isRecheck: !!recheckOf },
    );

    const { observation, recheck } = await this.prisma.$transaction(async (tx) => {
      const observation = await tx.observation.create({
        data: {
          ...dto,
          checkType:
            dto.checkType ?? (dto.complaints?.length ? CheckType.UNWELL : CheckType.ROUTINE),
          complaints: dto.complaints ?? [],
          observedAt,
          babyId,
          recordedById: caregiverId,
          riskLevel: assessment.level,
          riskReasons: {
            findings: assessment.findings,
            actions: assessment.actions,
          } as unknown as Prisma.InputJsonValue,
          riskEngineVer: assessment.engineVersion,
        },
      });
      if (recheckOf && recheckOf.status !== RecheckStatus.DONE) {
        await tx.recheck.update({
          where: { id: recheckOf.id },
          data: { status: RecheckStatus.DONE },
        });
      }
      // Earlier pending rechecks are superseded by this check.
      await tx.recheck.updateMany({
        where: { babyId, status: RecheckStatus.PENDING, id: { not: recheckOf?.id } },
        data: { status: RecheckStatus.DONE },
      });
      const recheck = assessment.recheck
        ? await tx.recheck.create({
            data: {
              babyId,
              observationId: observation.id,
              reason: assessment.findings[0]?.code ?? 'TEMPERATURE',
              dueAt: new Date(observedAt.getTime() + RECHECK_AFTER_MINUTES * 60_000),
            },
          })
        : null;
      return { observation, recheck };
    });

    return { duplicate: false, ...this.result(observation, recheck) };
  }

  private result(observation: Observation, recheck: { id: string; dueAt: Date } | null) {
    const presented = this.present(observation);
    return {
      observation: presented,
      assessment: {
        level: observation.riskLevel,
        findings: presented.findings,
        actions: presented.actions,
        engineVersion: observation.riskEngineVer,
        emergencyNumbers: observation.riskLevel === 'RED' ? this.emergencyNumbers : [],
      },
      recheck: recheck ? { id: recheck.id, dueAt: recheck.dueAt } : null,
    };
  }

  async list(caregiverId: string, babyId: string, q: ListObservationsQuery) {
    await this.babies.findOwned(caregiverId, babyId);
    const rows = await this.prisma.observation.findMany({
      where: {
        babyId,
        observedAt: {
          gte: q.from ? new Date(q.from) : undefined,
          lte: q.to ? new Date(q.to) : undefined,
          lt: q.before ? new Date(q.before) : undefined,
        },
      },
      orderBy: { observedAt: 'desc' },
      take: q.limit ?? 50,
    });
    return rows.map((o) => this.present(o));
  }

  async get(caregiverId: string, babyId: string, id: string) {
    await this.babies.findOwned(caregiverId, babyId);
    const o = await this.prisma.observation.findFirst({ where: { id, babyId } });
    if (!o) throw new BadRequestException('Unknown observation');
    return this.present(o);
  }

  /** FR-CHK-12 */
  async attachPhoto(caregiverId: string, babyId: string, id: string, file?: Express.Multer.File) {
    await this.babies.findOwned(caregiverId, babyId);
    if (!file) throw new BadRequestException('file is required');
    const detected = sniffDocumentMime(file.buffer);
    if (detected !== 'image/jpeg' && detected !== 'image/png')
      throw new BadRequestException('Only JPEG or PNG images');
    const o = await this.prisma.observation.findFirst({ where: { id, babyId } });
    if (!o) throw new BadRequestException('Unknown observation');
    const key = await this.storage.put(
      `babies/${babyId}/checks`,
      file.originalname || 'photo.jpg',
      file.buffer,
    );
    await this.prisma.observation.update({ where: { id }, data: { photoKey: key } });
    if (o.photoKey) await this.storage.delete([o.photoKey]);
    return { photoUrl: this.files.url(key, detected) };
  }

  async rechecks(caregiverId: string, babyId: string, status?: RecheckStatus) {
    await this.babies.findOwned(caregiverId, babyId);
    return this.prisma.recheck.findMany({
      where: { babyId, status },
      orderBy: { dueAt: 'desc' },
      take: 20,
      select: { id: true, reason: true, dueAt: true, status: true, observationId: true },
    });
  }

  /** J1: notify caregivers whose rechecks are due; mark old ones missed. */
  async dueRechecks(now = new Date()) {
    const due = await this.prisma.recheck.findMany({
      where: { status: RecheckStatus.PENDING, notifiedAt: null, dueAt: { lte: now } },
      include: { baby: true },
      take: 200,
    });
    await this.prisma.recheck.updateMany({
      where: {
        status: RecheckStatus.PENDING,
        dueAt: { lt: new Date(now.getTime() - 2 * 60 * 60_000) },
      },
      data: { status: RecheckStatus.MISSED },
    });
    return due;
  }

  present(o: Observation) {
    const reasons = o.riskReasons as { findings?: RiskFinding[]; actions?: string[] } | null;
    return {
      id: o.id,
      checkType: o.checkType,
      complaints: o.complaints,
      complaintText: o.complaintText,
      observedAt: o.observedAt,
      temperatureC: o.temperatureC == null ? null : Number(o.temperatureC),
      temperatureSrc: o.temperatureSrc,
      feedingCount24h: o.feedingCount24h,
      feedingQuality: o.feedingQuality,
      stoolPattern: o.stoolPattern,
      skinColor: o.skinColor,
      cry: o.cry,
      activity: o.activity,
      breathing: o.breathing,
      respiratoryRate: o.respiratoryRate,
      chestIndrawing: o.chestIndrawing,
      breathingSound: o.breathingSound,
      jaundice: o.jaundice,
      cordStatus: o.cordStatus,
      vomiting: o.vomiting,
      roomFeel: o.roomFeel,
      clothing: o.clothing,
      convulsions: o.convulsions,
      notes: o.notes,
      voiceNoteId: o.voiceNoteId,
      recheckOfId: o.recheckOfId,
      photoUrl: this.files.url(o.photoKey),
      riskLevel: o.riskLevel,
      riskEngineVer: o.riskEngineVer,
      findings: reasons?.findings ?? [],
      actions: reasons?.actions ?? [],
      createdAt: o.createdAt,
    };
  }
}
