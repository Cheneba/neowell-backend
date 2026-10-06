import { Injectable, NotFoundException } from '@nestjs/common';
import { FacilityService } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFacilityDto,
  NearbyFacilitiesQuery,
  SearchFacilitiesQuery,
  UpdateFacilityDto,
} from './dto/facility.dto';
import { boundingBox, haversineKm } from './geo';

/** Services that can care for a sick newborn — the default referral filter. */
const NEWBORN_CAPABLE: FacilityService[] = [
  FacilityService.NEONATOLOGY,
  FacilityService.PAEDIATRICS,
];

@Injectable()
export class FacilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nearest newborn-capable facilities by straight-line distance.
   * TODO: rank by travel time once a routing provider is chosen (PDR §5).
   */
  async nearby(q: NearbyFacilitiesQuery) {
    const radiusKm = q.radiusKm ?? 50;
    const box = boundingBox(q.lat, q.lon, radiusKm);
    const facilities = await this.prisma.facility.findMany({
      where: {
        isActive: true,
        latitude: { gte: box.minLat, lte: box.maxLat },
        longitude: { gte: box.minLon, lte: box.maxLon },
        services: q.service ? { has: q.service } : { hasSome: NEWBORN_CAPABLE },
      },
      include: { departments: true },
    });
    return facilities
      .map((f) => ({
        ...f,
        distanceKm: round1(haversineKm(q.lat, q.lon, f.latitude, f.longitude)),
      }))
      .filter((f) => f.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 20);
  }

  async get(id: string) {
    const facility = await this.prisma.facility.findFirst({
      where: { id, isActive: true },
      include: { departments: true },
    });
    if (!facility) throw new NotFoundException('Facility not found');
    return facility;
  }

  /** FR-FAC-02: name search, e.g. for picking the birth facility. */
  search(q: SearchFacilitiesQuery) {
    return this.prisma.facility.findMany({
      where: { isActive: true, ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      take: q.limit ?? 20,
      select: { id: true, name: true, city: true, region: true, services: true },
    });
  }

  async update(id: string, dto: UpdateFacilityDto) {
    const { departments, ...data } = dto;
    const exists = await this.prisma.facility.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Facility not found');
    return this.prisma.$transaction(async (tx) => {
      if (departments) {
        await tx.facilityDepartment.deleteMany({ where: { facilityId: id } });
        await tx.facilityDepartment.createMany({
          data: departments.map((d) => ({ ...d, facilityId: id })),
        });
      }
      return tx.facility.update({ where: { id }, data, include: { departments: true } });
    });
  }

  create(dto: CreateFacilityDto) {
    const { departments, ...data } = dto;
    return this.prisma.facility.create({
      data: { ...data, departments: departments ? { create: departments } : undefined },
      include: { departments: true },
    });
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
