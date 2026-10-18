import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');
/** Treats `KEY=` (empty) as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const envBase = z.object({
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
  SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
  TWILIO_ACCOUNT_SID: optional(z.string()),
  TWILIO_AUTH_TOKEN: optional(z.string()),
  TWILIO_FROM: optional(z.string()),
  TWILIO_MESSAGING_SERVICE_SID: optional(z.string()),

  PUSH_DRIVER: z.enum(['expo', 'log', 'fcm']).default('expo'),
  EXPO_ACCESS_TOKEN: optional(z.string()),
  FIREBASE_SERVICE_ACCOUNT: optional(z.string()),

  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  FILE_URL_SECRET: secret,

  R2_ACCOUNT_ID: optional(z.string()),
  R2_ACCESS_KEY_ID: optional(z.string()),
  R2_SECRET_ACCESS_KEY: optional(z.string()),
  R2_BUCKET: optional(z.string()),
  R2_ENDPOINT: optional(z.string().url()),
  R2_REGION: z.string().default('auto'),

  PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(15),
  EMERGENCY_PHONE_NUMBERS: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['SANDBOX', 'CAMPAY']).default('SANDBOX'),
  PAYMENTS_WEBHOOK_SECRET: secret,

  CAMPAY_BASE_URL: optional(z.string().url()),
  CAMPAY_APP_USERNAME: optional(z.string()),
  CAMPAY_APP_PASSWORD: optional(z.string()),
  CAMPAY_PERMANENT_TOKEN: optional(z.string()),

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

export const envSchema = envBase.superRefine((env, ctx) => {
  if (env.SMS_PROVIDER === 'twilio') {
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'required when SMS_PROVIDER=twilio' });
      }
    }
    if (!env.TWILIO_FROM && !env.TWILIO_MESSAGING_SERVICE_SID) {
      ctx.addIssue({
        code: 'custom',
        path: ['TWILIO_FROM'],
        message: 'set TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID when SMS_PROVIDER=twilio',
      });
    }
  }

  if (env.PUSH_DRIVER === 'fcm' && !env.FIREBASE_SERVICE_ACCOUNT) {
    ctx.addIssue({
      code: 'custom',
      path: ['FIREBASE_SERVICE_ACCOUNT'],
      message: 'required when PUSH_DRIVER=fcm',
    });
  }

  if (env.PAYMENT_PROVIDER === 'CAMPAY') {
    if (!env.CAMPAY_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['CAMPAY_BASE_URL'],
        message: 'required when PAYMENT_PROVIDER=CAMPAY',
      });
    }
    if (!env.CAMPAY_PERMANENT_TOKEN && !(env.CAMPAY_APP_USERNAME && env.CAMPAY_APP_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CAMPAY_APP_USERNAME'],
        message:
          'set CAMPAY_PERMANENT_TOKEN, or both CAMPAY_APP_USERNAME and CAMPAY_APP_PASSWORD, when PAYMENT_PROVIDER=CAMPAY',
      });
    }
  }

  if (env.STORAGE_DRIVER !== 'r2') return;
  if (!env.R2_ACCOUNT_ID && !env.R2_ENDPOINT) {
    ctx.addIssue({
      code: 'custom',
      path: ['R2_ACCOUNT_ID'],
      message: 'required when STORAGE_DRIVER=r2 (or set R2_ENDPOINT)',
    });
  }
  const required = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
  for (const key of required) {
    if (!env[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=r2' });
    }
  }
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
    console.warn(
      'WARNING: SMS_PROVIDER=console in production — OTP codes are logged, not delivered.',
    );
  }
  return env;
}
