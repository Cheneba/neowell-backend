import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { sniffDocumentMime } from '../clinicians/file-type';
import { AuthUser } from '../common/auth-user';
import { FilesService } from '../files/files.service';
import { Message } from '../generated/prisma/client';
import { MessageKind, Role } from '../generated/prisma/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { clinicianDisplayName } from '../clinicians/clinician-presenter';
import { maskContacts } from './contact-mask';
import { ConsultationsService } from './consultations.service';

const MESSAGE_NOTIFY_THROTTLE_MS = 2 * 60_000;

/** Consultation chat (FR-CONS-07/08). */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consultations: ConsultationsService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthUser, consultationId: string, after?: string, limit = 50) {
    await this.consultations.findForParticipant(user, consultationId);
    const cursor = after
      ? await this.prisma.message.findFirst({ where: { id: after, consultationId } })
      : null;
    const rows = await this.prisma.message.findMany({
      where: { consultationId, ...(cursor ? { createdAt: { gt: cursor.createdAt } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: { sender: { select: { role: true } } },
    });
    return rows.map((m) => this.present(m, user));
  }

  async sendText(user: AuthUser, consultationId: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Message is empty');
    const c = await this.openChat(user, consultationId);
    const { text: safe, masked } = maskContacts(text);
    const m = await this.prisma.message.create({
      data: {
        consultationId,
        senderId: user.id,
        kind: MessageKind.TEXT,
        body: safe,
        contactMasked: masked,
      },
      include: { sender: { select: { role: true } } },
    });
    await this.notifyOther(user, c, safe);
    return this.present(m, user);
  }

  async sendImage(user: AuthUser, consultationId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    const detected = sniffDocumentMime(file.buffer);
    if (detected !== 'image/jpeg' && detected !== 'image/png')
      throw new BadRequestException('Only JPEG or PNG images');
    const c = await this.openChat(user, consultationId);
    const key = await this.storage.put(
      `consultations/${consultationId}`,
      file.originalname || 'photo.jpg',
      file.buffer,
    );
    const m = await this.prisma.message.create({
      data: { consultationId, senderId: user.id, kind: MessageKind.IMAGE, attachmentKey: key },
      include: { sender: { select: { role: true } } },
    });
    await this.notifyOther(user, c, '📷');
    return this.present(m, user);
  }

  async markRead(user: AuthUser, consultationId: string, upToId: string) {
    await this.consultations.findForParticipant(user, consultationId);
    const upTo = await this.prisma.message.findFirst({ where: { id: upToId, consultationId } });
    if (!upTo) throw new BadRequestException('Unknown message');
    await this.prisma.message.updateMany({
      where: {
        consultationId,
        readAt: null,
        createdAt: { lte: upTo.createdAt },
        NOT: { senderId: user.id },
      },
      data: { readAt: new Date() },
    });
  }

  private async openChat(user: AuthUser, consultationId: string) {
    const c = await this.consultations.findForParticipant(user, consultationId);
    if (!this.consultations.chatOpen(c))
      throw new ConflictException('The chat is closed for this consultation');
    return c;
  }

  /** Push the other participant, at most once every 2 minutes per consultation. */
  private async notifyOther(
    user: AuthUser,
    c: Awaited<ReturnType<ConsultationsService['findForParticipant']>>,
    preview: string,
  ) {
    const toUserId = user.role === Role.CAREGIVER ? c.clinician.userId : c.caregiverId;
    const recent = await this.prisma.notification.findFirst({
      where: {
        userId: toUserId,
        type: 'NEW_MESSAGE',
        createdAt: { gt: new Date(Date.now() - MESSAGE_NOTIFY_THROTTLE_MS) },
        data: { path: ['consultationId'], equals: c.id },
      },
    });
    const queued = await this.prisma.job.findFirst({
      where: {
        queue: 'notify',
        status: 'QUEUED',
        payload: { path: ['data', 'consultationId'], equals: c.id },
      },
    });
    if (recent || queued) return;
    const from =
      user.role === Role.CAREGIVER
        ? (c.caregiver.firstName ?? 'Mother')
        : clinicianDisplayName(c.clinician);
    await this.notifications.notify({
      userId: toUserId,
      type: 'NEW_MESSAGE',
      params: { from, preview: preview.slice(0, 80) },
      data: { url: `/consultation/${c.id}`, consultationId: c.id },
    });
  }

  present(m: Message & { sender?: { role: Role } | null }, user: AuthUser) {
    return {
      id: m.id,
      kind: m.kind,
      body: m.body,
      imageUrl: m.kind === MessageKind.IMAGE ? this.files.url(m.attachmentKey) : null,
      senderRole: m.sender?.role ?? null,
      mine: m.senderId === user.id,
      contactMasked: m.contactMasked,
      readAt: m.readAt,
      createdAt: m.createdAt,
    };
  }
}
