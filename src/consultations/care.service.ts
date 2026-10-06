import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthUser } from '../common/auth-user';
import { ConsultationStatus } from '../generated/prisma/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { BabiesService } from '../babies/babies.service';
import { ConsultationsService } from './consultations.service';
import { DrugChartDto, ReferralDto, ReviewDto } from './dto/consultation.dto';

const CLINICAL_STATES: ConsultationStatus[] = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Outcomes of a consultation: referral, drug chart, review (FR-CONS-11..13). */
@Injectable()
export class CareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consultations: ConsultationsService,
    private readonly babies: BabiesService,
    private readonly notifications: NotificationsService,
  ) {}

  async refer(user: AuthUser, id: string, dto: ReferralDto) {
    const c = await this.clinical(user, id);
    if (c.referral) throw new ConflictException('This consultation already has a referral');
    let facilityName = dto.facilityName?.trim();
    if (dto.facilityId) {
      const f = await this.prisma.facility.findUnique({ where: { id: dto.facilityId } });
      if (!f) throw new BadRequestException('Unknown facilityId');
      facilityName = f.name;
    }
    if (!facilityName) throw new BadRequestException('facilityId or facilityName is required');
    const code = `NW-${Array.from(randomBytes(5), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
    const baby = await this.babies.presentById(c.babyId);
    await this.prisma.$transaction(async (tx) => {
      await tx.referral.create({
        data: {
          consultationId: c.id,
          babyId: c.babyId,
          facilityId: dto.facilityId,
          facilityName,
          urgency: dto.urgency,
          reason: dto.reason,
          code,
        },
      });
      await this.notifications.notify(
        {
          userId: c.caregiverId,
          type: 'REFERRAL_CREATED',
          params: { facility: facilityName!, baby: baby.displayName, code },
          data: { url: `/consultation/${c.id}` },
          sms: true,
        },
        tx,
      );
    });
    return (await this.consultations.get(user, id)).referral;
  }

  async prescribe(user: AuthUser, id: string, dto: DrugChartDto) {
    const c = await this.clinical(user, id);
    if (c.drugChart) throw new ConflictException('This consultation already has a drug chart');
    const baby = await this.babies.presentById(c.babyId);
    const chart = await this.prisma.$transaction(async (tx) => {
      const created = await tx.drugChart.create({
        data: {
          babyId: c.babyId,
          consultationId: c.id,
          prescribedById: user.id,
          startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
          items: { create: dto.items },
        },
        include: { items: true },
      });
      await this.notifications.notify(
        {
          userId: c.caregiverId,
          type: 'DRUG_CHART_CREATED',
          params: { baby: baby.displayName },
          data: { url: `/baby/${c.babyId}/medicines` },
        },
        tx,
      );
      return created;
    });
    return chart;
  }

  async review(user: AuthUser, id: string, dto: ReviewDto) {
    const c = await this.consultations.findForParticipant(user, id);
    if (c.status !== ConsultationStatus.COMPLETED)
      throw new ConflictException('You can review a consultation once it is completed');
    if (c.review) throw new ConflictException('You already reviewed this consultation');
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          consultationId: c.id,
          caregiverId: user.id,
          clinicianId: c.clinicianId,
          rating: dto.rating,
          comment: dto.comment,
        },
      });
      const agg = await tx.review.aggregate({
        where: { clinicianId: c.clinicianId },
        _avg: { rating: true },
        _count: { _all: true },
      });
      await tx.clinicianProfile.update({
        where: { id: c.clinicianId },
        data: { ratingAvg: agg._avg.rating ?? null, ratingCount: agg._count._all },
      });
      return { rating: review.rating, comment: review.comment };
    });
  }

  private async clinical(user: AuthUser, id: string) {
    const c = await this.consultations.findForParticipant(user, id);
    if (!CLINICAL_STATES.includes(c.status))
      throw new ConflictException(`Not possible while the consultation is ${c.status}`);
    return c;
  }
}
