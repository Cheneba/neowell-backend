/**
 * Seeds an admin account (and, outside production, one clearly-fake demo facility).
 *   SEED_ADMIN_PHONE=+2376XXXXXXXX npm run db:seed
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
      create: { phone: adminPhone, role: 'ADMIN', fullName: 'NeoWell Admin' },
    });
    console.log(`Admin ready: ${adminPhone}`);
  } else {
    console.log('SEED_ADMIN_PHONE not set — skipping admin user');
  }

  if (process.env.NODE_ENV !== 'production') {
    const name = 'Demo Neonatal Centre (sample data)';
    if (!(await prisma.facility.findFirst({ where: { name } }))) {
      await prisma.facility.create({
        data: {
          name,
          region: 'North West',
          city: 'Bamenda',
          latitude: 5.9597,
          longitude: 10.1453,
          services: ['NEONATOLOGY', 'PAEDIATRICS', 'OPD'],
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
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
