import { Injectable } from '@nestjs/common';
import { RiskLevel } from '../generated/prisma/enums';
import { ObservationsService } from '../observations/observations.service';
import { PrismaService } from '../prisma/prisma.service';
import { checksPerDay } from '../triage/check-schedule';
import { isHighRiskBaby } from '../triage/risk-engine';

export type SummaryDays = 3 | 7;

/**
 * Clinician-ready summary of the last N days of checks (PDR §3 "Clinician summary report").
 * The JSON shape is also what gets snapshotted onto a consultation at booking time.
 * TODO: PDF rendering of this summary.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly observations: ObservationsService,
  ) {}

  /** Caller must have already authorised access to `babyId`. */
  async summary(babyId: string, days: SummaryDays, now = new Date()) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const baby = await this.prisma.baby.findUniqueOrThrow({ where: { id: babyId } });
    const rows = await this.prisma.observation.findMany({
      where: { babyId, observedAt: { gte: since, lte: now } },
      orderBy: { observedAt: 'asc' },
    });
    const obs = rows.map((o) => this.observations.present(o));

    const temps = obs.filter((o) => o.temperatureC != null).map((o) => o.temperatureC as number);
    const count = (level: RiskLevel) => obs.filter((o) => o.riskLevel === level).length;
    const findingCounts: Record<string, number> = {};
    for (const o of obs)
      for (const f of o.findings) findingCounts[f.code] = (findingCounts[f.code] ?? 0) + 1;

    const expectedChecks = days * checksPerDay(baby.dateOfBirth, now);
    return {
      generatedAt: now.toISOString(),
      period: { days, from: since.toISOString(), to: now.toISOString() },
      baby: {
        id: baby.id,
        name: baby.name,
        sex: baby.sex,
        dateOfBirth: baby.dateOfBirth,
        ageDays: Math.floor((now.getTime() - baby.dateOfBirth.getTime()) / 86_400_000),
        birthWeightGrams: baby.birthWeightGrams,
        gestationalAgeWeeks: baby.gestationalAgeWeeks,
        birthHospital: baby.birthHospital,
        dischargeDate: baby.dischargeDate,
        isHighRisk: isHighRiskBaby({ ageHours: 0, ...baby }),
      },
      totals: {
        checks: obs.length,
        expectedChecks,
        green: count(RiskLevel.GREEN),
        yellow: count(RiskLevel.YELLOW),
        red: count(RiskLevel.RED),
      },
      latestRiskLevel: obs.at(-1)?.riskLevel ?? null,
      temperature: temps.length
        ? { min: Math.min(...temps), max: Math.max(...temps), latest: temps.at(-1) }
        : null,
      findingCounts,
      observations: obs.map((o) => ({
        observedAt: o.observedAt,
        riskLevel: o.riskLevel,
        temperatureC: o.temperatureC,
        feedingCount24h: o.feedingCount24h,
        feedingQuality: o.feedingQuality,
        stoolPattern: o.stoolPattern,
        skinColor: o.skinColor,
        cry: o.cry,
        activity: o.activity,
        breathing: o.breathing,
        jaundice: o.jaundice,
        cordStatus: o.cordStatus,
        convulsions: o.convulsions,
        notes: o.notes,
        findings: o.findings.map((f) => f.code),
      })),
    };
  }
}
