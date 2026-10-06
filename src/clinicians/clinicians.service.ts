import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FilesService } from '../files/files.service';
import { Prisma } from '../generated/prisma/client';
import {
  ClinicianDocumentType,
  ConsultationStatus,
  VerificationStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { freeSlots } from '../consultations/scheduling';
import { isAvailableNow, presentPublicClinician } from './clinician-presenter';
import {
  ListCliniciansQuery,
  RegisterClinicianDto,
  SetAvailabilityDto,
  UpdateClinicianDto,
} from './dto/clinician.dto';

/** Required before review (FR-CLIN-01/02): the three documents and a profile photo. */
export const REQUIRED_DOCUMENTS = Object.values(ClinicianDocumentType);
export const ALLOWED_DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const ACTIVE: ConsultationStatus[] = ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS'];

@Injectable()
export class CliniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
  ) {}

  async register(userId: string, dto: RegisterClinicianDto) {
    const { firstName, lastName, ...profile } = dto;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { firstName: firstName.trim(), lastName: lastName.trim() },
        });
        await tx.clinicianProfile.create({ data: { ...profile, userId } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Profile or license number already registered');
      }
      throw e;
    }
    return this.myProfile(userId);
  }

  async myProfile(userId: string) {
    const profile = await this.prisma.clinicianProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { firstName: true, lastName: true } },
        documents: { select: { id: true, type: true, originalName: true, uploadedAt: true } },
        availability: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
      },
    });
    if (!profile) throw new NotFoundException('Clinician profile not registered yet');
    const uploaded = new Set(profile.documents.map((d) => d.type));
    const missingDocuments = REQUIRED_DOCUMENTS.filter((t) => !uploaded.has(t));
    return {
      ...presentPublicClinician(profile, this.files),
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      licenseNumber: profile.licenseNumber,
      offersChat: profile.offersChat,
      offersAudio: profile.offersAudio,
      offersVideo: profile.offersVideo,
      feeChatXaf: profile.feeChatXaf,
      feeAudioXaf: profile.feeAudioXaf,
      feeVideoXaf: profile.feeVideoXaf,
      availableNowUntil: isAvailableNow(profile) ? profile.availableNowUntil : null,
      payoutProvider: profile.payoutProvider,
      payoutPhone: profile.payoutPhone,
      verificationStatus: profile.verificationStatus,
      verificationNote: profile.verificationNote,
      documents: profile.documents,
      availability: profile.availability.map(({ dayOfWeek, startMinute, endMinute }) => ({
        dayOfWeek,
        startMinute,
        endMinute,
      })),
      missingDocuments,
      missingForReview: [...missingDocuments, ...(profile.photoKey ? [] : ['PHOTO'])],
    };
  }

  async update(userId: string, dto: UpdateClinicianDto) {
    const profile = await this.requireProfile(userId);
    const { firstName, lastName, ...data } = dto;
    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { firstName: firstName?.trim(), lastName: lastName?.trim() },
        }),
        this.prisma.clinicianProfile.update({ where: { id: profile.id }, data }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('License number already registered');
      }
      throw e;
    }
    return this.myProfile(userId);
  }

  async uploadPhoto(userId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    if (!['image/jpeg', 'image/png'].includes(file.mimetype))
      throw new BadRequestException('Only JPEG or PNG images');
    const profile = await this.requireProfile(userId);
    const key = await this.storage.put(
      `clinicians/${profile.id}/photo`,
      file.originalname || 'photo.jpg',
      file.buffer,
    );
    await this.prisma.clinicianProfile.update({
      where: { id: profile.id },
      data: { photoKey: key },
    });
    if (profile.photoKey) await this.storage.delete([profile.photoKey]);
    await this.maybeQueueForReview(profile.id);
    return { photoUrl: this.files.url(key, file.mimetype) };
  }

  async uploadDocument(userId: string, type: ClinicianDocumentType, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    if (!ALLOWED_DOCUMENT_MIME.includes(file.mimetype)) {
      throw new BadRequestException(`Allowed file types: ${ALLOWED_DOCUMENT_MIME.join(', ')}`);
    }
    const profile = await this.requireProfile(userId);
    if (profile.verificationStatus === VerificationStatus.SUSPENDED)
      throw new BadRequestException('Profile is suspended');

    const storageKey = await this.storage.put(
      `clinicians/${profile.id}/documents`,
      file.originalname,
      file.buffer,
    );
    const doc = await this.prisma.clinicianDocument.create({
      data: {
        clinicianId: profile.id,
        type,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
      select: { id: true, type: true, originalName: true, uploadedAt: true },
    });
    await this.maybeQueueForReview(profile.id);
    return doc;
  }

  /** Photo + all three documents → PENDING_REVIEW (from PENDING_DOCUMENTS or REJECTED). */
  private async maybeQueueForReview(clinicianId: string) {
    const profile = await this.prisma.clinicianProfile.findUniqueOrThrow({
      where: { id: clinicianId },
      include: { documents: { select: { type: true } } },
    });
    const complete =
      !!profile.photoKey &&
      REQUIRED_DOCUMENTS.every((t) => profile.documents.some((d) => d.type === t));
    if (
      complete &&
      (profile.verificationStatus === VerificationStatus.PENDING_DOCUMENTS ||
        profile.verificationStatus === VerificationStatus.REJECTED)
    ) {
      await this.prisma.clinicianProfile.update({
        where: { id: profile.id },
        data: { verificationStatus: VerificationStatus.PENDING_REVIEW, verificationNote: null },
      });
    }
  }

  async setAvailability(userId: string, dto: SetAvailabilityDto) {
    for (const s of dto.slots) {
      if (s.endMinute <= s.startMinute)
        throw new BadRequestException('endMinute must be after startMinute');
    }
    const profile = await this.requireProfile(userId);
    await this.prisma.$transaction([
      this.prisma.clinicianAvailability.deleteMany({ where: { clinicianId: profile.id } }),
      this.prisma.clinicianAvailability.createMany({
        data: dto.slots.map((s) => ({ ...s, clinicianId: profile.id })),
      }),
    ]);
    const rows = await this.prisma.clinicianAvailability.findMany({
      where: { clinicianId: profile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
    return rows.map(({ dayOfWeek, startMinute, endMinute }) => ({
      dayOfWeek,
      startMinute,
      endMinute,
    }));
  }

  /** FR-CLIN-04: "available now" for ASAP consultations, up to 4 hours. */
  async setAvailableNow(userId: string, minutes: number) {
    const profile = await this.requireProfile(userId);
    if (minutes > 0 && profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new BadRequestException('Only verified clinicians can be available now');
    }
    const availableNowUntil = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
    await this.prisma.clinicianProfile.update({
      where: { id: profile.id },
      data: { availableNowUntil },
    });
    return { availableNowUntil };
  }

  async earnings(userId: string) {
    const profile = await this.requireProfile(userId);
    const earned = {
      clinicianId: profile.id,
      status: { in: ['COMPLETED', 'NO_SHOW'] as ConsultationStatus[] },
      paymentStatus: 'PAID' as const,
    };
    const [pending, completedCount, payouts] = await Promise.all([
      this.prisma.consultation.aggregate({
        where: { ...earned, OR: [{ payoutId: null }, { payout: { status: 'PENDING' } }] },
        _sum: { clinicianEarningXaf: true },
      }),
      this.prisma.consultation.count({ where: earned }),
      this.prisma.payout.findMany({
        where: { clinicianId: profile.id },
        orderBy: { createdAt: 'desc' },
        take: 52,
      }),
    ]);
    return {
      pendingXaf: pending._sum.clinicianEarningXaf ?? 0,
      paidXaf: payouts.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountXaf, 0),
      completedCount,
      payouts,
    };
  }

  /** Public directory: only verified, active clinicians (FR-CLIN-03/05). */
  async listVerified(q: ListCliniciansQuery = {}) {
    const now = new Date();
    const offers = {
      CHAT: { offersChat: true },
      AUDIO: { offersAudio: true },
      VIDEO: { offersVideo: true },
    };
    const rows = await this.prisma.clinicianProfile.findMany({
      where: {
        verificationStatus: VerificationStatus.VERIFIED,
        user: { isActive: true },
        ...(q.medium ? offers[q.medium] : {}),
        ...(q.availableNow === 'true' ? { availableNowUntil: { gt: now } } : {}),
      },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    return rows
      .map((c) => presentPublicClinician(c, this.files))
      .sort((a, b) => Number(b.availableNow) - Number(a.availableNow));
  }

  async getVerified(id: string) {
    const c = await this.findVerified(id);
    return {
      ...presentPublicClinician(c, this.files),
      availability: c.availability.map(({ dayOfWeek, startMinute, endMinute }) => ({
        dayOfWeek,
        startMinute,
        endMinute,
      })),
    };
  }

  async slots(id: string, days = 7) {
    const c = await this.findVerified(id);
    const now = new Date();
    const booked = await this.prisma.consultation.findMany({
      where: {
        clinicianId: id,
        status: { in: [...ACTIVE, 'AWAITING_PAYMENT'] },
        scheduledAt: { gte: new Date(now.getTime() - 3_600_000) },
      },
      select: { scheduledAt: true },
    });
    return {
      slots: freeSlots(
        c.availability,
        booked.map((b) => b.scheduledAt),
        now,
        days,
      ),
    };
  }

  private async findVerified(id: string) {
    const c = await this.prisma.clinicianProfile.findFirst({
      where: { id, verificationStatus: VerificationStatus.VERIFIED, user: { isActive: true } },
      include: { user: { select: { firstName: true, lastName: true } }, availability: true },
    });
    if (!c) throw new NotFoundException('Clinician not found');
    return c;
  }

  async requireProfile(userId: string) {
    const profile = await this.prisma.clinicianProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Clinician profile not registered yet');
    return profile;
  }
}
