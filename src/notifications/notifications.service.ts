import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';
import { SmsService } from './sms.service';
import { render } from './templates';

export interface NotifyInput {
  userId: string;
  type: string;
  params?: Record<string, string | number>;
  /** Extra data for the app, e.g. { url: '/consultation/123' } for deep links. */
  data?: Record<string, unknown>;
  /** Fall back to SMS when the user has no push device (FR-NOT-03). */
  sms?: boolean;
}

/** In-app inbox + push + SMS fallback (FR-NOT, docs/05 Q1–Q3). */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly push: PushService,
    private readonly sms: SmsService,
  ) {}

  onModuleInit() {
    this.jobs.register('notify', (p) => this.deliver(p as unknown as NotifyInput));
    this.jobs.register('push.send', (p) =>
      this.sendPush(p as { notificationId: string; token: string }),
    );
    this.jobs.register('sms.send', (p) =>
      this.sendSms(p as { phone: string; message: string; notificationId?: string }),
    );
  }

  /** Queues a notification; pass `tx` to enqueue atomically with a domain change. */
  notify(input: NotifyInput, tx?: Prisma.TransactionClient) {
    return this.jobs.enqueue('notify', input as unknown as Record<string, unknown>, { tx });
  }

  /** Q1: write the inbox entry, then fan out to devices (or SMS). */
  private async deliver(input: NotifyInput) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      include: { devices: true },
    });
    if (!user || !user.isActive) return { skipped: true };
    const { title, body } = render(input.type, user.locale, input.params);
    const notification = await this.prisma.notification.create({
      data: {
        userId: user.id,
        type: input.type,
        title,
        body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });
    for (const d of user.devices) {
      await this.jobs.enqueue('push.send', {
        notificationId: notification.id,
        token: d.expoPushToken,
      });
    }
    if (!user.devices.length && input.sms) {
      await this.jobs.enqueue('sms.send', {
        phone: user.phone,
        message: `NeoWell: ${title}. ${body}`.slice(0, 300),
        notificationId: notification.id,
      });
    }
    return { notificationId: notification.id, devices: user.devices.length };
  }

  /** Q2 */
  private async sendPush({ notificationId, token }: { notificationId: string; token: string }) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n) return { skipped: true };
    const ticket = await this.push.send({
      to: token,
      title: n.title,
      body: n.body,
      data: { ...((n.data as object) ?? {}), notificationId: n.id, type: n.type },
    });
    if (ticket.status === 'error') {
      if (ticket.details?.error === 'DeviceNotRegistered') {
        await this.prisma.device.deleteMany({ where: { expoPushToken: token } });
        return { removedDevice: true };
      }
      throw new Error(ticket.message);
    }
    await this.prisma.notification.update({ where: { id: n.id }, data: { pushedAt: new Date() } });
    return { ticketId: ticket.id, token };
  }

  /** Q3 */
  private async sendSms({
    phone,
    message,
    notificationId,
  }: {
    phone: string;
    message: string;
    notificationId?: string;
  }) {
    await this.sms.send(phone, message);
    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { smsAt: new Date() },
      });
    }
  }

  /** J10: drop devices whose push tickets came back DeviceNotRegistered. */
  async checkReceipts() {
    const since = new Date(Date.now() - 60 * 60_000);
    const jobs = await this.prisma.job.findMany({
      where: { queue: 'push.send', status: 'DONE', finishedAt: { gte: since } },
      select: { payload: true },
    });
    const tickets = new Map<string, string>();
    for (const j of jobs) {
      const r = (j.payload as { result?: { ticketId?: string; token?: string } }).result;
      if (r?.ticketId && r.token) tickets.set(r.ticketId, r.token);
    }
    const receipts = await this.push.receipts([...tickets.keys()]);
    const dead = Object.entries(receipts)
      .filter(([, r]) => r.status === 'error' && r.details?.error === 'DeviceNotRegistered')
      .map(([id]) => tickets.get(id)!);
    if (dead.length)
      await this.prisma.device.deleteMany({ where: { expoPushToken: { in: dead } } });
    return dead.length;
  }

  // ── Inbox & devices (FR-ACC-05/06) ──────────────────────────

  async registerDevice(userId: string, expoPushToken: string, platform: string) {
    return this.prisma.device.upsert({
      where: { expoPushToken },
      update: { userId, platform, lastSeenAt: new Date() },
      create: { userId, expoPushToken, platform },
      select: { id: true },
    });
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.device.deleteMany({ where: { userId, expoPushToken: token } });
  }

  async inbox(userId: string, limit = 30, cursor?: string) {
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        readAt: true,
        createdAt: true,
      },
    });
    const unreadCount = await this.prisma.notification.count({ where: { userId, readAt: null } });
    const hasMore = items.length > limit;
    return {
      items: items.slice(0, limit),
      nextCursor: hasMore ? items[limit - 1].id : null,
      unreadCount,
    };
  }

  async markRead(userId: string, ids?: string[], all?: boolean) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(all ? {} : { id: { in: ids ?? [] } }) },
      data: { readAt: new Date() },
    });
  }
}
