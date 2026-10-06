import { BadRequestException, Injectable } from '@nestjs/common';
import { Baby, Measurement } from '../generated/prisma/client';
import { MeasurementSource } from '../generated/prisma/enums';
import { BabiesService } from '../babies/babies.service';
import { growthAgeDays } from '../babies/baby-facts';
import { PrismaService } from '../prisma/prisma.service';
import { flagFor, GrowthFlag, Indicator, zScore } from './who-growth';
import { CreateMeasurementDto } from './measurement.dto';

const FIELDS: {
  key: 'weight' | 'length' | 'headCircumference';
  indicator: Indicator;
  code: string;
}[] = [
  { key: 'weight', indicator: 'weightForAge', code: 'WEIGHT' },
  { key: 'length', indicator: 'lengthForAge', code: 'LENGTH' },
  { key: 'headCircumference', indicator: 'headCircumferenceForAge', code: 'HEAD_CIRCUMFERENCE' },
];

export interface GrowthItem {
  value: number;
  unit: 'g' | 'cm';
  measuredAt: Date;
  ageDays: number | null;
  zScore: number | null;
  flag: GrowthFlag | null;
}

export interface GrowthFinding {
  code: string;
  level: 'YELLOW' | 'RED';
  direction?: 'LOW' | 'HIGH';
}

const valueOf = (m: Measurement, key: (typeof FIELDS)[number]['key']): number | null => {
  if (key === 'weight') return m.weightGrams;
  const v = key === 'length' ? m.lengthCm : m.headCircumferenceCm;
  return v == null ? null : Number(v);
};

@Injectable()
export class GrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
  ) {}

  async add(caregiverId: string, babyId: string, dto: CreateMeasurementDto) {
    const baby = await this.babies.findOwned(caregiverId, babyId);
    if (dto.weightGrams == null && dto.lengthCm == null && dto.headCircumferenceCm == null) {
      throw new BadRequestException('Enter at least one of weight, length or head circumference');
    }
    const measuredAt = new Date(dto.measuredAt);
    if (measuredAt > new Date(Date.now() + 5 * 60_000))
      throw new BadRequestException('measuredAt cannot be in the future');
    if (measuredAt < baby.dateOfBirth)
      throw new BadRequestException('measuredAt cannot be before the date of birth');
    const measurement = await this.prisma.measurement.create({
      data: { ...dto, measuredAt, babyId, recordedById: caregiverId },
    });
    return { measurement: this.presentMeasurement(measurement), growth: await this.growth(baby) };
  }

  async list(caregiverId: string, babyId: string, limit = 50) {
    await this.babies.findOwned(caregiverId, babyId);
    const rows = await this.prisma.measurement.findMany({
      where: { babyId },
      orderBy: { measuredAt: 'desc' },
      take: limit,
    });
    return rows.map((m) => this.presentMeasurement(m));
  }

  async forCaregiver(caregiverId: string, babyId: string) {
    return this.growth(await this.babies.findOwned(caregiverId, babyId));
  }

  /** Latest value of each measurement with its WHO z-score and flag (FR-MEAS-04/05). */
  async growth(baby: Baby) {
    const rows = await this.prisma.measurement.findMany({
      where: { babyId: baby.id },
      orderBy: { measuredAt: 'desc' },
    });
    const latest: Record<string, GrowthItem | null> = {
      weight: null,
      length: null,
      headCircumference: null,
    };
    const flags: GrowthFinding[] = [];

    for (const f of FIELDS) {
      const m = rows.find((r) => valueOf(r, f.key) != null);
      if (!m) continue;
      const value = valueOf(m, f.key)!;
      const age = growthAgeDays(baby.dateOfBirth, baby.gestationalAgeWeeks, m.measuredAt);
      const z =
        baby.sex && age != null
          ? zScore(f.indicator, baby.sex, age, f.key === 'weight' ? value / 1000 : value)
          : null;
      const flag = flagFor(z);
      latest[f.key] = {
        value,
        unit: f.key === 'weight' ? 'g' : 'cm',
        measuredAt: m.measuredAt,
        ageDays: age,
        zScore: z,
        flag,
      };
      if (flag && flag !== 'NORMAL') {
        flags.push({
          code: `${f.code}_${flag}`,
          level: flag === 'FAR_OUT_OF_RANGE' ? 'RED' : 'YELLOW',
          direction: (z as number) < 0 ? 'LOW' : 'HIGH',
        });
      }
    }

    // FR-MEAS-05: more than 10% below birth weight in the first 14 days.
    const birth =
      rows.find((r) => r.source === MeasurementSource.BIRTH)?.weightGrams ?? baby.birthWeightGrams;
    const latestWeight = rows.find(
      (r) => r.weightGrams != null && r.source !== MeasurementSource.BIRTH,
    );
    if (birth && latestWeight) {
      const days = (latestWeight.measuredAt.getTime() - baby.dateOfBirth.getTime()) / 86_400_000;
      if (days <= 14 && latestWeight.weightGrams! < birth * 0.9)
        flags.push({ code: 'EXCESS_WEIGHT_LOSS', level: 'YELLOW' });
    }

    return {
      latest,
      flags,
      usesCorrectedAge: baby.gestationalAgeWeeks != null && baby.gestationalAgeWeeks < 37,
    };
  }

  presentMeasurement(m: Measurement) {
    return {
      id: m.id,
      measuredAt: m.measuredAt,
      weightGrams: m.weightGrams,
      lengthCm: m.lengthCm == null ? null : Number(m.lengthCm),
      headCircumferenceCm: m.headCircumferenceCm == null ? null : Number(m.headCircumferenceCm),
      source: m.source,
      notes: m.notes,
      createdAt: m.createdAt,
    };
  }
}
