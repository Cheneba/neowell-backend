import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateConsentsDto, UpdateMeDto } from './dto/user.dto';

export const ACCOUNT_PURGE_DAYS = 30;

export function presentUser(u: User) {
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    locale: u.locale,
    region: u.region,
    city: u.city,
    consentDataCollectionAt: u.consentDataCollectionAt,
    consentClinicianShareAt: u.consentClinicianShareAt,
    consentRecordingAt: u.consentRecordingAt,
    profileComplete: !!(u.firstName?.trim() && u.lastName?.trim()),
    deletionRequestedAt: u.deletionRequestedAt,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    return presentUser(await this.prisma.user.findUniqueOrThrow({ where: { id: userId } }));
  }

  async update(userId: string, dto: UpdateMeDto) {
    try {
      const data = {
        ...dto,
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
      };
      return presentUser(await this.prisma.user.update({ where: { id: userId }, data }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw e;
    }
  }

  async updateConsents(userId: string, dto: UpdateConsentsDto) {
    const stamp = (v: boolean | undefined) => (v === undefined ? undefined : v ? new Date() : null);
    return presentUser(
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          consentDataCollectionAt: stamp(dto.dataCollection),
          consentClinicianShareAt: stamp(dto.clinicianShare),
          consentRecordingAt: stamp(dto.recording),
        },
      }),
    );
  }

  /** FR-ACC-03: everything we hold about the caregiver and their babies. */
  async export(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const babies = await this.prisma.baby.findMany({
      where: { caregiverId: userId, deletedAt: null },
      include: {
        measurements: { orderBy: { measuredAt: 'asc' } },
        observations: { orderBy: { observedAt: 'asc' } },
        consultations: {
          include: {
            messages: { orderBy: { createdAt: 'asc' } },
            referral: true,
            drugChart: { include: { items: true } },
          },
        },
      },
    });
    return { exportedAt: new Date().toISOString(), profile: presentUser(user), babies };
  }

  /** FR-ACC-04: access ends now; the data is purged after 30 days by job J9. */
  async requestDeletion(userId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { deletionRequestedAt: now, isActive: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.device.deleteMany({ where: { userId } }),
      this.prisma.clinicianProfile.updateMany({
        where: { userId },
        data: { availableNowUntil: null },
      }),
    ]);
    return { purgeAfter: new Date(now.getTime() + ACCOUNT_PURGE_DAYS * 86_400_000).toISOString() };
  }
}
