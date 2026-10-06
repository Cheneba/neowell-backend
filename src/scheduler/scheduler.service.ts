import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdminService } from '../admin/admin.service';
import { ChecksService } from '../checks/checks.service';
import { BabiesService } from '../babies/babies.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceService } from './maintenance.service';

const TZ = 'Africa/Douala';
const LOCK = { payouts: 7007, purge: 9009 };

/** Cron entry points J1–J10 (docs/05 §2). Each run is safe on several instances. */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
    private readonly checks: ChecksService,
    private readonly babies: BabiesService,
    private readonly consultations: ConsultationsService,
    private readonly notifications: NotificationsService,
    private readonly admin: AdminService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private async run(name: string, fn: () => Promise<unknown>) {
    if (!this.jobs.enabled) return;
    try {
      await fn();
    } catch (e) {
      this.logger.error(`${name} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** J1 */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: TZ })
  rechecks() {
    return this.run('rechecks.remind', () => this.remindRechecks());
  }

  async remindRechecks(now = new Date()) {
    const due = await this.checks.dueRechecks(now);
    for (const r of due) {
      const { count } = await this.prisma.recheck.updateMany({
        where: { id: r.id, notifiedAt: null },
        data: { notifiedAt: now },
      });
      if (!count) continue;
      const baby = await this.babies.presentById(r.babyId);
      await this.notifications.notify({
        userId: r.baby.caregiverId,
        type: 'RECHECK_DUE',
        params: { baby: baby.displayName },
        data: { url: `/baby/${r.babyId}/check?type=UNWELL&recheckOf=${r.id}` },
        sms: true,
      });
    }
    return due.length;
  }

  /** J2 */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: TZ })
  expire() {
    return this.run('consultations.expire', () => this.consultations.expireDue());
  }

  /** J3 */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: TZ })
  remind() {
    return this.run('consultations.remind', () => this.consultations.remindStartingSoon());
  }

  /** J4 */
  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: TZ })
  reconcile() {
    return this.run('payments.reconcile', () => this.consultations.reconcilePayments());
  }

  /** J5 */
  @Cron('0 8 * * *', { timeZone: TZ })
  namePrompts() {
    return this.run('babies.namePrompt', () => this.maintenance.namePrompts());
  }

  /** J6 */
  @Cron('0 8-20 * * *', { timeZone: TZ })
  nudges() {
    return this.run('checks.nudge', () => this.maintenance.checkNudges());
  }

  /** J7 */
  @Cron('0 6 * * 1', { timeZone: TZ })
  payouts() {
    return this.run('payouts.weekly', () =>
      this.jobs.withLock(LOCK.payouts, async () => void (await this.admin.createWeeklyPayouts())),
    );
  }

  /** J8 */
  @Cron('0 3 * * *', { timeZone: TZ })
  cleanup() {
    return this.run('maintenance.cleanup', () => this.maintenance.cleanup());
  }

  /** J9 */
  @Cron('30 3 * * *', { timeZone: TZ })
  purge() {
    return this.run('accounts.purge', () =>
      this.jobs.withLock(LOCK.purge, async () => void (await this.maintenance.purgeAccounts())),
    );
  }

  /** J10 */
  @Cron('*/15 * * * *', { timeZone: TZ })
  receipts() {
    return this.run('push.receipts', () => this.notifications.checkReceipts());
  }
}
