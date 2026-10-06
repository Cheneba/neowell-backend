import { Injectable } from '@nestjs/common';
import { displayNames, NAMING_AGE_DAYS } from '../babies/baby-facts';
import { toBabyLike } from '../babies/babies.service';
import { CareStatus } from '../generated/prisma/enums';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ACCOUNT_PURGE_DAYS } from '../users/users.service';

const DAY = 86_400_000;

/** Scheduled jobs J5, J6, J8, J9 (docs/05 §2). */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {
    this.jobs.register('storage.delete', async (p) => this.storage.delete(p.keys as string[]));
  }

  /** J5: day-42 prompt to add the baby's name (FR-BABY-02). */
  async namePrompts(now = new Date()) {
    const babies = await this.prisma.baby.findMany({
      where: {
        deletedAt: null,
        givenName: null,
        namePromptSentAt: null,
        dateOfBirth: { lte: new Date(now.getTime() - NAMING_AGE_DAYS * DAY) },
        caregiver: { isActive: true },
      },
      include: { caregiver: { include: { babies: { where: { deletedAt: null } } } } },
      take: 200,
    });
    for (const b of babies) {
      const name =
        displayNames(b.caregiver.babies.map(toBabyLike), b.caregiver.lastName, now).get(b.id) ??
        'Your baby';
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.baby.updateMany({
          where: { id: b.id, namePromptSentAt: null },
          data: { namePromptSentAt: now },
        });
        if (count)
          await this.notifications.notify(
            {
              userId: b.caregiverId,
              type: 'BABY_NAME_PROMPT',
              params: { baby: name },
              data: { url: `/baby/${b.id}/edit` },
            },
            tx,
          );
      });
    }
    return babies.length;
  }

  /** J6: gentle nudge when a baby under 28 days has had no check for 24 h (FR-NOT-05). */
  async checkNudges(now = new Date()) {
    const babies = await this.prisma.baby.findMany({
      where: {
        deletedAt: null,
        careStatus: CareStatus.AT_HOME,
        dateOfBirth: { gt: new Date(now.getTime() - 28 * DAY) },
        createdAt: { lt: new Date(now.getTime() - DAY) },
        observations: { none: { observedAt: { gt: new Date(now.getTime() - DAY) } } },
        caregiver: { isActive: true, devices: { some: {} } },
      },
      include: { caregiver: { include: { babies: { where: { deletedAt: null } } } } },
      take: 500,
    });
    let sent = 0;
    for (const b of babies) {
      const recent = await this.prisma.notification.count({
        where: {
          userId: b.caregiverId,
          type: 'CHECK_NUDGE',
          createdAt: { gt: new Date(now.getTime() - DAY) },
        },
      });
      if (recent) continue;
      const name =
        displayNames(b.caregiver.babies.map(toBabyLike), b.caregiver.lastName, now).get(b.id) ??
        'your baby';
      await this.notifications.notify({
        userId: b.caregiverId,
        type: 'CHECK_NUDGE',
        params: { baby: name },
        data: { url: `/baby/${b.id}` },
      });
      sent++;
    }
    return sent;
  }

  /** J8: retention clean-up. */
  async cleanup(now = new Date()) {
    const [otp, tokens, done, failed, hooks, stuck] = await Promise.all([
      this.prisma.otpCode.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - DAY) } },
      }),
      this.prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date(now.getTime() - 30 * DAY) } },
            { revokedAt: { lt: new Date(now.getTime() - 30 * DAY) } },
          ],
        },
      }),
      this.prisma.job.deleteMany({
        where: { status: 'DONE', finishedAt: { lt: new Date(now.getTime() - 14 * DAY) } },
      }),
      this.prisma.job.deleteMany({
        where: { status: 'FAILED', finishedAt: { lt: new Date(now.getTime() - 90 * DAY) } },
      }),
      this.prisma.webhookEvent.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY) } },
      }),
      this.jobs.requeueStuck(),
    ]);
    return {
      otp: otp.count,
      tokens: tokens.count,
      jobs: done.count + failed.count,
      webhooks: hooks.count,
      requeued: stuck.count,
    };
  }

  /** J9: purge accounts 30 days after deletion was requested (FR-ACC-04). */
  async purgeAccounts(now = new Date()) {
    const users = await this.prisma.user.findMany({
      where: {
        deletionRequestedAt: { lte: new Date(now.getTime() - ACCOUNT_PURGE_DAYS * DAY) },
        phone: { not: { startsWith: 'deleted:' } },
      },
      include: {
        babies: {
          include: {
            observations: { select: { photoKey: true } },
            voiceNotes: { select: { storageKey: true } },
          },
        },
      },
      take: 50,
    });
    for (const u of users) {
      const keys = u.babies.flatMap((b) => [
        ...b.observations.map((o) => o.photoKey).filter((k): k is string => !!k),
        ...b.voiceNotes.map((v) => v.storageKey),
      ]);
      await this.prisma.$transaction(async (tx) => {
        // Consultations are kept for clinical continuity; detach them from the deleted babies' data.
        const babyIds = u.babies.map((b) => b.id);
        const kept = await tx.consultation.findMany({
          where: { babyId: { in: babyIds } },
          select: { id: true, previsitSummary: true },
        });
        for (const k of kept) {
          // Remove names from the stored pre-visit summary.
          const summary = k.previsitSummary as { baby?: Record<string, unknown> } | null;
          if (summary?.baby) {
            summary.baby = { ...summary.baby, displayName: 'Deleted account', givenName: null };
            await tx.consultation.update({
              where: { id: k.id },
              data: { previsitSummary: summary as object },
            });
          }
        }
        if (kept.length) {
          // Consultations reference babies with cascade: keep them by re-pointing to an anonymised placeholder baby.
          const placeholder = await tx.baby.create({
            data: { caregiverId: u.id, givenName: null, dateOfBirth: new Date(0), deletedAt: now },
          });
          await tx.consultation.updateMany({
            where: { id: { in: kept.map((k) => k.id) } },
            data: { babyId: placeholder.id, observationId: null },
          });
          await tx.drugChart.updateMany({
            where: { babyId: { in: babyIds } },
            data: { babyId: placeholder.id },
          });
          await tx.referral.updateMany({
            where: { babyId: { in: babyIds } },
            data: { babyId: placeholder.id },
          });
        }
        await tx.baby.deleteMany({ where: { id: { in: babyIds } } });
        await tx.device.deleteMany({ where: { userId: u.id } });
        await tx.notification.deleteMany({ where: { userId: u.id } });
        await tx.voiceNote.deleteMany({ where: { ownerId: u.id } });
        await tx.user.update({
          where: { id: u.id },
          data: {
            phone: `deleted:${u.id}`,
            email: null,
            firstName: null,
            lastName: null,
            region: null,
            city: null,
            isActive: false,
          },
        });
        if (keys.length) await this.jobs.enqueue('storage.delete', { keys }, { tx });
      });
    }
    return users.length;
  }
}
