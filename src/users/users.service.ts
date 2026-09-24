import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateConsentsDto, UpdateMeDto } from './dto/user.dto';

const publicUser = {
  id: true,
  phone: true,
  email: true,
  fullName: true,
  role: true,
  locale: true,
  consentDataCollectionAt: true,
  consentClinicianShareAt: true,
  consentRecordingAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser });
  }

  async update(userId: string, dto: UpdateMeDto) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: dto,
        select: publicUser,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw e;
    }
  }

  updateConsents(userId: string, dto: UpdateConsentsDto) {
    const stamp = (v: boolean | undefined) => (v === undefined ? undefined : v ? new Date() : null);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        consentDataCollectionAt: stamp(dto.dataCollection),
        consentClinicianShareAt: stamp(dto.clinicianShare),
        consentRecordingAt: stamp(dto.recording),
      },
      select: publicUser,
    });
  }
}
