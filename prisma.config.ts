import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Read directly (not via `env()`) so `prisma generate` works without a database,
    // e.g. during `npm ci` in the Docker build.
    url: process.env.DATABASE_URL ?? '',
  },
});
