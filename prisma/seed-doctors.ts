/**
 * Development-only: seeds 11 fictional doctors in different situations, so the mobile app's
 * doctor list, booking and clinician flows can be tried.
 *   npm run db:seed:doctors
 * Safe to re-run: doctors are matched by phone and reset to the values below.
 * Every doctor can sign in as a clinician with the console SMS driver (the code is in the backend log).
 * Names, numbers and licences are invented. Never run this against a real database.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed sample doctors when NODE_ENV=production.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

type Status = 'VERIFIED' | 'PENDING_REVIEW' | 'PENDING_DOCUMENTS' | 'REJECTED' | 'SUSPENDED';
type Window = { days: number[]; from: number; to: number }; // minutes from midnight, 0 = Sunday

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const h = (hours: number) => hours * 60;

interface Doctor {
  phone: string;
  firstName: string;
  lastName: string;
  title: string;
  city: string;
  region: string;
  status: Status;
  specialties: string[];
  bio: string;
  facility: string;
  years: number;
  media: { chat: number | null; audio: number | null; video: number | null }; // fee in XAF, null = not offered
  rating: { avg: number; count: number } | null;
  /** Hours from now that "available now" lasts; negative = lapsed; null = never switched on. */
  availableNowHours: number | null;
  windows: Window[];
  note?: string;
}

const DOCTORS: Doctor[] = [
  {
    phone: '+237690000101',
    firstName: 'Amina',
    lastName: 'Ngono',
    title: 'Dr',
    city: 'Yaoundé',
    region: 'Centre',
    status: 'VERIFIED',
    specialties: ['NEONATOLOGY', 'PAEDIATRICS'],
    bio: 'Neonatologist with a focus on premature babies and feeding problems. (Sample data)',
    facility: 'Demo Neonatal Centre',
    years: 14,
    media: { chat: 2000, audio: 4000, video: 6000 },
    rating: { avg: 4.9, count: 128 },
    availableNowHours: 24 * 365,
    windows: [{ days: ALL_WEEK, from: h(7), to: h(21) }],
  },
  {
    phone: '+237690000102',
    firstName: 'Joseph',
    lastName: 'Fotso',
    title: 'Dr',
    city: 'Douala',
    region: 'Littoral',
    status: 'VERIFIED',
    specialties: ['PAEDIATRICS'],
    bio: 'General paediatrician. Chat only, quick answers and low fee. (Sample data)',
    facility: 'Demo Community Clinic',
    years: 6,
    media: { chat: 1000, audio: null, video: null },
    rating: { avg: 4.4, count: 31 },
    availableNowHours: 24 * 365,
    windows: [{ days: WEEKDAYS, from: h(8), to: h(18) }],
  },
  {
    phone: '+237690000103',
    firstName: 'Mireille',
    lastName: 'Tchoumi',
    title: 'Dr',
    city: 'Bamenda',
    region: 'North West',
    status: 'VERIFIED',
    specialties: ['PAEDIATRICS', 'OPD'],
    bio: 'Works weekdays at the hospital. Audio and video only, not available right now. (Sample data)',
    facility: 'Demo Regional Hospital',
    years: 9,
    media: { chat: null, audio: 3500, video: 5500 },
    rating: { avg: 4.7, count: 64 },
    availableNowHours: null,
    windows: [{ days: WEEKDAYS, from: h(14), to: h(20) }],
  },
  {
    phone: '+237690000104',
    firstName: 'Samuel',
    lastName: 'Etoundi',
    title: 'Dr',
    city: 'Yaoundé',
    region: 'Centre',
    status: 'VERIFIED',
    specialties: ['NEONATOLOGY'],
    bio: 'Available on weekends only. (Sample data)',
    facility: 'Demo University Hospital',
    years: 11,
    media: { chat: 2500, audio: 4500, video: 7000 },
    rating: { avg: 4.6, count: 47 },
    availableNowHours: null,
    windows: [{ days: [0, 6], from: h(9), to: h(17) }],
  },
  {
    phone: '+237690000105',
    firstName: 'Grace',
    lastName: 'Mbarga',
    title: 'Dr',
    city: 'Buea',
    region: 'South West',
    status: 'VERIFIED',
    specialties: ['PAEDIATRICS', 'KANGAROO_CARE'],
    bio: 'Newly verified, no reviews yet. Supports kangaroo care at home. (Sample data)',
    facility: 'Demo District Hospital',
    years: 2,
    media: { chat: 1500, audio: 3000, video: 4500 },
    rating: null,
    availableNowHours: 24 * 365,
    windows: [{ days: ALL_WEEK, from: h(10), to: h(16) }],
  },
  {
    phone: '+237690000106',
    firstName: 'Pierre',
    lastName: 'Kamga',
    title: 'Prof',
    city: 'Douala',
    region: 'Littoral',
    status: 'VERIFIED',
    specialties: ['PAEDIATRIC_CARDIOLOGY', 'NEONATOLOGY'],
    bio: 'Senior specialist. Highest fee, mixed reviews. (Sample data)',
    facility: 'Demo Specialist Centre',
    years: 25,
    media: { chat: 5000, audio: 9000, video: 15000 },
    rating: { avg: 3.4, count: 22 },
    availableNowHours: 24 * 365,
    windows: [{ days: [1, 3, 5], from: h(9), to: h(13) }],
  },
  {
    phone: '+237690000107',
    firstName: 'Estelle',
    lastName: 'Nkeng',
    title: 'Dr',
    city: 'Bafoussam',
    region: 'West',
    status: 'VERIFIED',
    specialties: ['PAEDIATRICS'],
    bio: 'Switched "available now" on earlier, and it has lapsed. (Sample data)',
    facility: 'Demo Regional Hospital',
    years: 7,
    media: { chat: 2000, audio: 3500, video: 5000 },
    rating: { avg: 4.8, count: 90 },
    availableNowHours: -3,
    windows: [{ days: ALL_WEEK, from: h(6), to: h(22) }],
  },
  {
    phone: '+237690000108',
    firstName: 'David',
    lastName: 'Atangana',
    title: 'Dr',
    city: 'Garoua',
    region: 'North',
    status: 'PENDING_REVIEW',
    specialties: ['PAEDIATRICS'],
    bio: 'Submitted all documents, waiting for an admin to review. (Sample data)',
    facility: 'Demo District Hospital',
    years: 4,
    media: { chat: 1500, audio: 3000, video: 4500 },
    rating: null,
    availableNowHours: null,
    windows: [{ days: WEEKDAYS, from: h(8), to: h(16) }],
  },
  {
    phone: '+237690000109',
    firstName: 'Laure',
    lastName: 'Biyong',
    title: 'Dr',
    city: 'Ebolowa',
    region: 'South',
    status: 'PENDING_DOCUMENTS',
    specialties: ['NEONATOLOGY'],
    bio: 'Registered but has not uploaded documents or a photo yet. (Sample data)',
    facility: 'Demo District Hospital',
    years: 3,
    media: { chat: 1500, audio: 3000, video: 4500 },
    rating: null,
    availableNowHours: null,
    windows: [],
  },
  {
    phone: '+237690000110',
    firstName: 'Armand',
    lastName: 'Nji',
    title: 'Dr',
    city: 'Bamenda',
    region: 'North West',
    status: 'REJECTED',
    specialties: ['PAEDIATRICS'],
    bio: 'Application rejected. (Sample data)',
    facility: 'Demo Community Clinic',
    years: 1,
    media: { chat: 1000, audio: 2000, video: 3000 },
    rating: null,
    availableNowHours: null,
    windows: [],
    note: 'Medical licence could not be verified. Please upload a clearer copy.',
  },
  {
    phone: '+237690000111',
    firstName: 'Cécile',
    lastName: 'Onana',
    title: 'Dr',
    city: 'Yaoundé',
    region: 'Centre',
    status: 'SUSPENDED',
    specialties: ['PAEDIATRICS', 'NEONATOLOGY'],
    bio: 'Was verified, then suspended after complaints. Hidden from caregivers. (Sample data)',
    facility: 'Demo University Hospital',
    years: 10,
    media: { chat: 2000, audio: 4000, video: 6000 },
    rating: { avg: 2.1, count: 9 },
    availableNowHours: null,
    windows: [{ days: WEEKDAYS, from: h(8), to: h(17) }],
    note: 'Suspended pending investigation of caregiver complaints.',
  },
];

async function main() {
  for (const [i, d] of DOCTORS.entries()) {
    const user = await prisma.user.upsert({
      where: { phone: d.phone },
      update: {
        role: 'CLINICIAN',
        firstName: d.firstName,
        lastName: d.lastName,
        city: d.city,
        region: d.region,
        isActive: true,
      },
      create: {
        phone: d.phone,
        role: 'CLINICIAN',
        firstName: d.firstName,
        lastName: d.lastName,
        city: d.city,
        region: d.region,
      },
    });

    const verified = d.status === 'VERIFIED' || d.status === 'SUSPENDED';
    const data = {
      title: d.title,
      specialties: d.specialties,
      bio: d.bio,
      currentFacility: d.facility,
      yearsExperience: d.years,
      offersChat: d.media.chat !== null,
      offersAudio: d.media.audio !== null,
      offersVideo: d.media.video !== null,
      feeChatXaf: d.media.chat ?? 0,
      feeAudioXaf: d.media.audio ?? 0,
      feeVideoXaf: d.media.video ?? 0,
      availableNowUntil:
        d.availableNowHours === null ? null : new Date(Date.now() + d.availableNowHours * 3_600_000),
      verificationStatus: d.status,
      verificationNote: d.note ?? null,
      verifiedAt: verified ? new Date(Date.now() - 30 * 86_400_000) : null,
      ratingAvg: d.rating?.avg ?? null,
      ratingCount: d.rating?.count ?? 0,
    };
    const profile = await prisma.clinicianProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: {
        ...data,
        userId: user.id,
        licenseNumber: `SEED-DOC-${String(i + 1).padStart(2, '0')}`,
      },
    });

    await prisma.clinicianAvailability.deleteMany({ where: { clinicianId: profile.id } });
    const rows = d.windows.flatMap((w) =>
      w.days.map((dayOfWeek) => ({
        clinicianId: profile.id,
        dayOfWeek,
        startMinute: w.from,
        endMinute: w.to,
      })),
    );
    if (rows.length) await prisma.clinicianAvailability.createMany({ data: rows });

    console.log(`${d.status.padEnd(18)} ${d.title} ${d.firstName} ${d.lastName}  ${d.phone}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
