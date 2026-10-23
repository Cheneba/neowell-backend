import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReviewClinicianDto } from '../clinicians/dto/clinician.dto';
import { REQUIRED_DOCUMENTS } from '../clinicians/clinicians.service';
import { FilesService } from '../files/files.service';
import { JobStatus, PayoutStatus, VerificationStatus } from '../generated/prisma/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async clinicians(status?: VerificationStatus) {
    const rows = await this.prisma.clinicianProfile.findMany({
      where: { verificationStatus: status },
      include: {
        user: {
          select: { firstName: true, lastName: true, phone: true, email: true, isActive: true },
        },
        documents: true,
      },
      orderBy: { updatedAt: 'asc' },
    });
    return rows.map((c) => ({
      ...c,
      photoUrl: this.files.url(c.photoKey),
      documents: c.documents.map((d) => ({
        id: d.id,
        type: d.type,
        originalName: d.originalName,
        uploadedAt: d.uploadedAt,
        url: this.files.url(d.storageKey, d.mimeType),
      })),
    }));
  }

  async review(adminId: string, clinicianId: string, dto: ReviewClinicianDto) {
    const profile = await this.prisma.clinicianProfile.findUnique({
      where: { id: clinicianId },
      include: { documents: { select: { type: true } } },
    });
    if (!profile) throw new NotFoundException('Clinician not found');
    if (dto.decision === 'VERIFIED') {
      const missing: string[] = REQUIRED_DOCUMENTS.filter(
        (t) => !profile.documents.some((d) => d.type === t),
      );
      if (!profile.photoKey) missing.push('PHOTO');
      if (missing.length)
        throw new BadRequestException(`Cannot verify: missing ${missing.join(', ')}`);
    }
    const updated = await this.prisma.clinicianProfile.update({
      where: { id: clinicianId },
      data: {
        verificationStatus: dto.decision,
        verificationNote: dto.note ?? null,
        verifiedAt: dto.decision === 'VERIFIED' ? new Date() : null,
        verifiedById: adminId,
        ...(dto.decision === 'VERIFIED' ? {} : { availableNowUntil: null }),
      },
    });
    const type = {
      VERIFIED: 'CLINICIAN_VERIFIED',
      REJECTED: 'CLINICIAN_REJECTED',
      SUSPENDED: 'CLINICIAN_SUSPENDED',
    }[dto.decision];
    await this.notifications.notify({
      userId: profile.userId,
      type,
      params: { note: dto.note ?? '' },
      email: true,
    });
    if (dto.decision === 'SUSPENDED') {
      // Ends app sessions now; the clinician can still sign in on the web to see why.
      await this.prisma.refreshToken.updateMany({
        where: { userId: profile.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    // Keep the other admins in the loop.
    const [actor, subject, others] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: adminId },
        select: { firstName: true, lastName: true },
      }),
      this.prisma.user.findUnique({
        where: { id: profile.userId },
        select: { firstName: true, lastName: true },
      }),
      this.prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true, id: { not: adminId } },
        select: { id: true },
      }),
    ]);
    const full = (u: { firstName: string | null; lastName: string | null } | null) =>
      `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || '—';
    for (const a of others) {
      await this.notifications.notify({
        userId: a.id,
        type: 'ADMIN_CLINICIAN_DECISION',
        params: { admin: full(actor), name: full(subject), status: dto.decision },
        email: true,
      });
    }
    return updated;
  }

  async setUserActive(id: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!isActive)
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, role: true, isActive: true },
    });
  }

  payouts(status?: PayoutStatus) {
    return this.prisma.payout.findMany({
      where: { status },
      include: {
        clinician: {
          select: {
            id: true,
            title: true,
            payoutProvider: true,
            payoutPhone: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async markPayoutPaid(id: string, reference: string) {
    const p = await this.prisma.payout.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Payout not found');
    if (p.status === PayoutStatus.PAID) return p;
    return this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.PAID, paidAt: new Date(), reference },
    });
  }

  async stats() {
    const [caregivers, clinicians, babies, checks, consultations, revenue] = await Promise.all([
      this.prisma.user.count({ where: { role: 'CAREGIVER', isActive: true } }),
      this.prisma.clinicianProfile.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
      this.prisma.baby.count({ where: { deletedAt: null } }),
      this.prisma.observation.groupBy({ by: ['riskLevel'], _count: { _all: true } }),
      this.prisma.consultation.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.consultation.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { feeXaf: true, commissionXaf: true },
      }),
    ]);
    const toMap = <K extends string>(
      rows: ({ _count: { _all: number } } & Record<string, unknown>)[],
      key: K,
    ) => Object.fromEntries(rows.map((r) => [r[key] as string, r._count._all]));
    return {
      users: { caregivers, clinicians: toMap(clinicians, 'verificationStatus') },
      babies,
      checks: toMap(checks, 'riskLevel'),
      consultations: toMap(consultations, 'status'),
      revenueXaf: { gross: revenue._sum.feeXaf ?? 0, commission: revenue._sum.commissionXaf ?? 0 },
    };
  }

  /** Operational health for the dashboard: database, job queue, process. */
  async system() {
    const [jobCounts, oldest, failedByQueue, dbUp] = await Promise.all([
      this.prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.job.findFirst({
        where: { status: JobStatus.QUEUED },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.job.groupBy({
        by: ['queue'],
        where: { status: JobStatus.FAILED },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
    ]);
    const jobs: Record<string, number> = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0 };
    for (const r of jobCounts) jobs[r.status] = r._count._all;
    return {
      database: dbUp ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      jobs,
      oldestQueuedAt: oldest?.createdAt ?? null,
      failedByQueue: Object.fromEntries(failedByQueue.map((r) => [r.queue, r._count._all])),
    };
  }

  jobs(status: JobStatus = JobStatus.FAILED) {
    return this.prisma.job.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** J7: weekly payouts for completed, paid consultations not yet paid out. */
  async createWeeklyPayouts(now = new Date()) {
    const periodStart = new Date(now.getTime() - 7 * 86_400_000);
    const due = await this.prisma.consultation.findMany({
      where: { status: { in: ['COMPLETED', 'NO_SHOW'] }, paymentStatus: 'PAID', payoutId: null },
      select: { id: true, clinicianId: true, clinicianEarningXaf: true },
    });
    const byClinician = new Map<string, { ids: string[]; amount: number }>();
    for (const c of due) {
      const e = byClinician.get(c.clinicianId) ?? { ids: [], amount: 0 };
      e.ids.push(c.id);
      e.amount += c.clinicianEarningXaf;
      byClinician.set(c.clinicianId, e);
    }
    const created: string[] = [];
    for (const [clinicianId, { ids, amount }] of byClinician) {
      if (amount <= 0) continue;
      await this.prisma.$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: { clinicianId, periodStart, periodEnd: now, amountXaf: amount },
        });
        await tx.consultation.updateMany({
          where: { id: { in: ids }, payoutId: null },
          data: { payoutId: payout.id },
        });
        const clinician = await tx.clinicianProfile.findUniqueOrThrow({
          where: { id: clinicianId },
        });
        await this.notifications.notify(
          { userId: clinician.userId, type: 'PAYOUT_CREATED', params: { amount } },
          tx,
        );
        created.push(payout.id);
      });
    }
    return created;
  }
}
