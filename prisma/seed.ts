/**
 * Seeds an admin account and, outside production, one clearly-fake demo facility.
 *   SEED_ADMIN_PHONE=+2376XXXXXXXX npm run db:seed
 * With SEED_DEMO_CLINICIAN_PHONE set (development only), also creates a verified demo doctor
 * who is available all week and "available now", so consultations can be tried end to end
 * with the sandbox payment provider.
 * Real facility data must come from a verified, maintained dataset — never invent phone numbers.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const adminPhone = process.env.SEED_ADMIN_PHONE;
  if (adminPhone) {
    await prisma.user.upsert({
      where: { phone: adminPhone },
      update: { role: 'ADMIN' },
      create: { phone: adminPhone, role: 'ADMIN', firstName: 'NeoWell', lastName: 'Admin' },
    });
    console.log(`Admin ready: ${adminPhone}`);
  } else {
    console.log('SEED_ADMIN_PHONE not set — skipping admin user');
  }

  if (process.env.NODE_ENV === 'production') return;

  const name = 'Demo Neonatal Centre (sample data)';
  if (!(await prisma.facility.findFirst({ where: { name } }))) {
    await prisma.facility.create({
      data: {
        name,
        region: 'North West',
        city: 'Bamenda',
        latitude: 5.9597,
        longitude: 10.1453,
        services: ['NEONATOLOGY', 'PAEDIATRICS', 'OPD', 'KANGAROO_CARE'],
        mainPhone: '+237000000000',
        hours: '24/7',
        departments: {
          create: [
            { service: 'NEONATOLOGY', name: 'Neonatology', phone: '+237000000001' },
            { service: 'PAEDIATRICS', name: 'Paediatrics', phone: '+237000000002' },
          ],
        },
      },
    });
    console.log(`Created ${name}`);
  }

  const demoPhone = process.env.SEED_DEMO_CLINICIAN_PHONE;
  if (demoPhone) {
    const user = await prisma.user.upsert({
      where: { phone: demoPhone },
      update: {},
      create: { phone: demoPhone, role: 'CLINICIAN', firstName: 'Demo', lastName: 'Doctor' },
    });
    const existing = await prisma.clinicianProfile.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.clinicianProfile.create({
        data: {
          userId: user.id,
          licenseNumber: `DEMO-${user.id.slice(0, 8)}`,
          specialties: ['NEONATOLOGY', 'PAEDIATRICS'],
          bio: 'Demo clinician for development (sample data).',
          yearsExperience: 8,
          feeChatXaf: 2000,
          feeAudioXaf: 4000,
          feeVideoXaf: 6000,
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
          availableNowUntil: new Date(Date.now() + 365 * 86_400_000),
          availability: {
            create: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
              dayOfWeek: d,
              startMinute: 7 * 60,
              endMinute: 21 * 60,
            })),
          },
        },
      });
    }
    console.log(`Demo clinician ready: ${demoPhone}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
