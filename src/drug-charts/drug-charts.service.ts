import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { DoseStatus, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { BabiesService } from '../babies/babies.service';

const include = {
  items: { include: { doseLogs: { orderBy: { scheduledFor: 'desc' as const }, take: 60 } } },
  consultation: {
    select: {
      id: true,
      clinician: { select: { title: true, user: { select: { firstName: true, lastName: true } } } },
    },
  },
};

/** Caregiver medicines (FR-DRUG-01..03). */
@Injectable()
export class DrugChartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
  ) {}

  async forBaby(caregiverId: string, babyId: string, activeOnly: boolean) {
    await this.babies.findOwned(caregiverId, babyId);
    const charts = await this.prisma.drugChart.findMany({
      where: { babyId },
      include,
      orderBy: { startDate: 'desc' },
    });
    const presented = charts.map((c) => this.present(c));
    return activeOnly ? presented.filter((c) => c.active) : presented;
  }

  async get(user: AuthUser, id: string) {
    const chart = await this.prisma.drugChart.findUnique({
      where: { id },
      include: { ...include, baby: true },
    });
    const allowed =
      chart &&
      ((user.role === Role.CAREGIVER &&
        chart.baby.caregiverId === user.id &&
        !chart.baby.deletedAt) ||
        (user.role === Role.CLINICIAN && chart.prescribedById === user.id));
    if (!allowed) throw new NotFoundException('Drug chart not found');
    return this.present(chart);
  }

  async logDose(caregiverId: string, itemId: string, scheduledFor: Date, status: DoseStatus) {
    const item = await this.prisma.drugChartItem.findUnique({
      where: { id: itemId },
      include: { drugChart: { include: { baby: true } } },
    });
    if (!item || item.drugChart.baby.caregiverId !== caregiverId)
      throw new NotFoundException('Medicine not found');
    const start = item.drugChart.startDate;
    const end = new Date(start.getTime() + item.durationDays * 86_400_000);
    if (scheduledFor < new Date(start.getTime() - 86_400_000) || scheduledFor > end) {
      throw new BadRequestException('scheduledFor is outside this medicine plan');
    }
    return this.prisma.doseLog.upsert({
      where: { itemId_scheduledFor: { itemId, scheduledFor } },
      update: { status, loggedAt: new Date() },
      create: { itemId, scheduledFor, status },
    });
  }

  private present(c: {
    id: string;
    babyId: string;
    startDate: Date;
    createdAt: Date;
    consultation: {
      id: string;
      clinician: { title: string; user: { firstName: string | null; lastName: string | null } };
    } | null;
    items: {
      id: string;
      drugName: string;
      dose: string;
      route: string;
      timesOfDay: string[];
      durationDays: number;
      instructions: string | null;
      doseLogs: { scheduledFor: Date; status: DoseStatus; loggedAt: Date }[];
    }[];
  }) {
    const days = Math.max(...c.items.map((i) => i.durationDays), 0);
    const endsAt = new Date(c.startDate.getTime() + days * 86_400_000);
    const doc = c.consultation?.clinician;
    return {
      id: c.id,
      babyId: c.babyId,
      consultationId: c.consultation?.id ?? null,
      prescriber: doc
        ? [doc.title, doc.user.firstName, doc.user.lastName ? `${doc.user.lastName[0]}.` : '']
            .filter(Boolean)
            .join(' ')
        : null,
      startDate: c.startDate,
      endsAt,
      active: endsAt > new Date(),
      items: c.items.map((i) => ({
        id: i.id,
        drugName: i.drugName,
        dose: i.dose,
        route: i.route,
        timesOfDay: i.timesOfDay,
        durationDays: i.durationDays,
        instructions: i.instructions,
        doseLogs: i.doseLogs.map((d) => ({
          scheduledFor: d.scheduledFor,
          status: d.status,
          loggedAt: d.loggedAt,
        })),
      })),
      createdAt: c.createdAt,
    };
  }
}
