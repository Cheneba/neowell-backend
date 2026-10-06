import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');
/** Treats `KEY=` (empty) as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('*'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: secret,
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_SECRET: secret,
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  SMS_PROVIDER: z.enum(['console']).default('console'),
  PUSH_DRIVER: z.enum(['expo', 'log']).default('expo'),
  EXPO_ACCESS_TOKEN: optional(z.string()),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  FILE_URL_SECRET: secret,

  PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(15),
  EMERGENCY_PHONE_NUMBERS: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['SANDBOX']).default('SANDBOX'),
  PAYMENTS_WEBHOOK_SECRET: secret,

  LIVEKIT_URL: optional(z.string().url()),
  LIVEKIT_API_KEY: optional(z.string()),
  LIVEKIT_API_SECRET: optional(z.string()),

  STT_URL: optional(z.string().url()),
  STT_MODEL: z.string().default('Systran/faster-whisper-small'),

  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  JOBS_POLL_MS: z.coerce.number().int().min(200).default(2000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
    throw new Error('SMS_PROVIDER=console must not be used in production');
  }
  return env;
}
