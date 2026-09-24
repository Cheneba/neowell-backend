import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ClinicianDocumentType, VerificationStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  RegisterClinicianDto,
  ReviewClinicianDto,
  SetAvailabilityDto,
  UpdateClinicianDto,
} from './dto/clinician.dto';

/** Every document type a clinician must upload before review (PDR §3 "Physician Verification"). */
export const REQUIRED_DOCUMENTS = Object.values(ClinicianDocumentType);
export const ALLOWED_DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

const publicProfile = {
  id: true,
  specialties: true,
  bio: true,
  currentFacility: true,
  consultationFeeXaf: true,
  ratingAvg: true,
  ratingCount: true,
  user: { select: { fullName: true } },
  availability: { select: { dayOfWeek: true, startMinute: true, endMinute: true } },
} satisfies Prisma.ClinicianProfileSelect;

@Injectable()
export class CliniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async register(userId: string, dto: RegisterClinicianDto) {
    const { fullName, ...profile } = dto;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { fullName } });
        return tx.clinicianProfile.create({ data: { ...profile, userId } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Profile or license number already registered');
      }
      throw e;
    }
  }

  async myProfile(userId: string) {
    const profile = await this.prisma.clinicianProfile.findUnique({
      where: { userId },
      include: {
        documents: { select: { id: true, type: true, originalName: true, uploadedAt: true } },
        availability: true,
      },
    });
    if (!profile) throw new NotFoundException('Clinician profile not registered yet');
    const uploaded = new Set(profile.documents.map((d) => d.type));
    return { ...profile, missingDocuments: REQUIRED_DOCUMENTS.filter((t) => !uploaded.has(t)) };
  }

  async update(userId: string, dto: UpdateClinicianDto) {
    const profile = await this.requireProfile(userId);
    return this.prisma.clinicianProfile.update({ where: { id: profile.id }, data: dto });
  }

  async uploadDocument(userId: string, type: ClinicianDocumentType, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    if (!ALLOWED_DOCUMENT_MIME.includes(file.mimetype)) {
      throw new BadRequestException(`Allowed file types: ${ALLOWED_DOCUMENT_MIME.join(', ')}`);
    }
    const profile = await this.requireProfile(userId);
    if (profile.verificationStatus === VerificationStatus.SUSPENDED) {
      throw new BadRequestException('Profile is suspended');
    }

    const storageKey = await this.storage.put(
      `clinicians/${profile.id}`,
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

    // Once every required document is present, queue the profile for manual review.
    const types = await this.prisma.clinicianDocument.findMany({
      where: { clinicianId: profile.id },
      distinct: ['type'],
      select: { type: true },
    });
    const complete = REQUIRED_DOCUMENTS.every((t) => types.some((d) => d.type === t));
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
    return doc;
  }

  async setAvailability(userId: string, dto: SetAvailabilityDto) {
    for (const s of dto.slots) {
      if (s.endMinute <= s.startMinute) {
        throw new BadRequestException('endMinute must be after startMinute');
      }
    }
    const profile = await this.requireProfile(userId);
    await this.prisma.$transaction([
      this.prisma.clinicianAvailability.deleteMany({ where: { clinicianId: profile.id } }),
      this.prisma.clinicianAvailability.createMany({
        data: dto.slots.map((s) => ({ ...s, clinicianId: profile.id })),
      }),
    ]);
    return this.prisma.clinicianAvailability.findMany({
      where: { clinicianId: profile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
  }

  /** Public directory: only verified clinicians are ever listed or bookable. */
  listVerified() {
    return this.prisma.clinicianProfile.findMany({
      where: { verificationStatus: VerificationStatus.VERIFIED, user: { isActive: true } },
      select: publicProfile,
      orderBy: [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
  }

  async getVerified(id: string) {
    const c = await this.prisma.clinicianProfile.findFirst({
      where: { id, verificationStatus: VerificationStatus.VERIFIED, user: { isActive: true } },
      select: publicProfile,
    });
    if (!c) throw new NotFoundException('Clinician not found');
    return c;
  }

  // ── Admin ─────────────────────────────────────────────────

  reviewQueue() {
    return this.prisma.clinicianProfile.findMany({
      where: { verificationStatus: VerificationStatus.PENDING_REVIEW },
      include: {
        user: { select: { fullName: true, phone: true, email: true } },
        documents: true,
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async review(adminId: string, clinicianId: string, dto: ReviewClinicianDto) {
    const profile = await this.prisma.clinicianProfile.findUnique({
      where: { id: clinicianId },
      include: { documents: { select: { type: true } } },
    });
    if (!profile) throw new NotFoundException('Clinician not found');
    if (dto.decision === 'VERIFIED') {
      const missing = REQUIRED_DOCUMENTS.filter(
        (t) => !profile.documents.some((d) => d.type === t),
      );
      if (missing.length) {
        throw new BadRequestException(`Cannot verify: missing ${missing.join(', ')}`);
      }
    }
    return this.prisma.clinicianProfile.update({
      where: { id: clinicianId },
      data: {
        verificationStatus: dto.decision,
        verificationNote: dto.note ?? null,
        verifiedAt: dto.decision === 'VERIFIED' ? new Date() : null,
        verifiedById: adminId,
      },
    });
  }

  private async requireProfile(userId: string) {
    const profile = await this.prisma.clinicianProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Clinician profile not registered yet');
    return profile;
  }
}
