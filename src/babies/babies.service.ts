import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Baby } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CHECK_TIMES, checksPerDay } from '../triage/check-schedule';
import { isHighRiskBaby } from '../triage/risk-engine';
import { CreateBabyDto, UpdateBabyDto } from './dto/baby.dto';

@Injectable()
export class BabiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(caregiverId: string, dto: CreateBabyDto) {
    const data = {
      ...dto,
      dateOfBirth: new Date(dto.dateOfBirth),
      dischargeDate: toDate(dto.dischargeDate),
    };
    this.assertDates(data.dateOfBirth, data.dischargeDate);
    const baby = await this.prisma.baby.create({ data: { ...data, caregiverId } });
    return this.present(baby);
  }

  async list(caregiverId: string) {
    const babies = await this.prisma.baby.findMany({
      where: { caregiverId, deletedAt: null },
      orderBy: { dateOfBirth: 'desc' },
    });
    return babies.map((b) => this.present(b));
  }

  async get(caregiverId: string, id: string) {
    return this.present(await this.findOwned(caregiverId, id));
  }

  async update(caregiverId: string, id: string, dto: UpdateBabyDto) {
    const existing = await this.findOwned(caregiverId, id);
    const data = {
      ...dto,
      dateOfBirth: toDate(dto.dateOfBirth),
      dischargeDate: toDate(dto.dischargeDate),
    };
    this.assertDates(
      data.dateOfBirth ?? existing.dateOfBirth,
      data.dischargeDate ?? existing.dischargeDate ?? undefined,
    );
    return this.present(await this.prisma.baby.update({ where: { id }, data }));
  }

  /** Soft delete; hard deletion runs through the data-retention job (PDR §9). */
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
    const doneLast24h = await this.prisma.observation.count({
      where: { babyId: id, observedAt: { gte: since, lte: now } },
    });
    return {
      checksPerDay: perDay,
      reminderTimes: CHECK_TIMES[perDay],
      checksLast24h: doneLast24h,
      checksDue: Math.max(0, perDay - doneLast24h),
    };
  }

  private present(baby: Baby) {
    return { ...baby, isHighRisk: isHighRiskBaby({ ageHours: 0, ...baby }) };
  }

  private assertDates(dob: Date, discharge?: Date) {
    if (dob > new Date()) throw new BadRequestException('dateOfBirth cannot be in the future');
    if (discharge && discharge < dob) {
      throw new BadRequestException('dischargeDate cannot be before dateOfBirth');
    }
  }
}

const toDate = (iso?: string) => (iso ? new Date(iso) : undefined);
