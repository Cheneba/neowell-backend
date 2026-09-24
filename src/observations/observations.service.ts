import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BabiesService } from '../babies/babies.service';
import { Env } from '../config/env';
import { Observation } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ageInHours } from '../triage/check-schedule';
import { assessRisk, RiskFinding } from '../triage/risk-engine';
import { CreateObservationDto, ListObservationsQuery } from './dto/observation.dto';

@Injectable()
export class ObservationsService {
  private readonly emergencyNumbers: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
    config: ConfigService<Env, true>,
  ) {
    this.emergencyNumbers = config
      .get('EMERGENCY_PHONE_NUMBERS', { infer: true })
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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

    const now = new Date();
    const observedAt = dto.observedAt ? new Date(dto.observedAt) : now;
    if (observedAt.getTime() > now.getTime() + 5 * 60 * 1000) {
      throw new BadRequestException('observedAt cannot be in the future');
    }
    if (observedAt < baby.dateOfBirth) {
      throw new BadRequestException('observedAt cannot be before the date of birth');
    }

    const assessment = assessRisk(dto, {
      ageHours: ageInHours(baby.dateOfBirth, observedAt),
      gestationalAgeWeeks: baby.gestationalAgeWeeks,
      birthWeightGrams: baby.birthWeightGrams,
    });

    const observation = await this.prisma.observation.create({
      data: {
        ...dto,
        observedAt,
        babyId,
        recordedById: caregiverId,
        riskLevel: assessment.level,
        riskReasons: { findings: assessment.findings, actions: assessment.actions } as object,
        riskEngineVer: assessment.engineVersion,
      },
    });

    return {
      observation: this.present(observation),
      assessment: {
        ...assessment,
        emergencyNumbers: assessment.level === 'RED' ? this.emergencyNumbers : [],
      },
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
        },
      },
      orderBy: { observedAt: 'desc' },
      take: q.limit ?? 50,
    });
    return rows.map((o) => this.present(o));
  }

  present(o: Observation) {
    const reasons = o.riskReasons as { findings?: RiskFinding[]; actions?: string[] } | null;
    return {
      ...o,
      temperatureC: o.temperatureC == null ? null : Number(o.temperatureC),
      riskReasons: undefined,
      findings: reasons?.findings ?? [],
      actions: reasons?.actions ?? [],
    };
  }
}
