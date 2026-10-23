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
  /** Public URL of the web dashboard, used in emails to admins. */
  DASHBOARD_URL: z.string().url().default('http://localhost:3001'),

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
  /** Sender number or alphanumeric ID; ignored when a messaging service is set. */
  TWILIO_FROM: optional(z.string()),
  TWILIO_MESSAGING_SERVICE_SID: optional(z.string()),

  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('NeoWell <no-reply@neowell.local>'),
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  /** true = implicit TLS (port 465); false = STARTTLS when offered (port 587). */
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: optional(z.string()),
  SMTP_PASS: optional(z.string()),

  PUSH_DRIVER: z.enum(['expo', 'fcm', 'log']).default('expo'),
  EXPO_ACCESS_TOKEN: optional(z.string()),
  /** Firebase service-account key: the JSON itself, or the JSON base64-encoded (easier in env vars). */
  FIREBASE_SERVICE_ACCOUNT: optional(z.string()),

  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  R2_ACCOUNT_ID: optional(z.string()),
  R2_ACCESS_KEY_ID: optional(z.string()),
  R2_SECRET_ACCESS_KEY: optional(z.string()),
  R2_BUCKET: optional(z.string()),
  /** Override for any other S3-compatible endpoint; defaults to the account's R2 endpoint. */
  R2_ENDPOINT: optional(z.string().url()),
  R2_REGION: z.string().default('auto'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  FILE_URL_SECRET: secret,

  PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(15),
  EMERGENCY_PHONE_NUMBERS: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['SANDBOX', 'CAMPAY']).default('SANDBOX'),
  /** https://demo.campay.net/api for the sandbox, https://www.campay.net/api for live. */
  CAMPAY_BASE_URL: z.string().url().default('https://demo.campay.net/api'),
  CAMPAY_APP_USERNAME: optional(z.string()),
  CAMPAY_APP_PASSWORD: optional(z.string()),
  /** Alternative to username/password: the app's permanent access token. */
  CAMPAY_PERMANENT_TOKEN: optional(z.string()),
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
  // Each real driver needs its credentials; fail at boot rather than on the first request.
  const need = (driver: string, vars: (keyof Env)[]) => {
    const missing = vars.filter((k) => !env[k]);
    if (missing.length) throw new Error(`${driver} requires: ${missing.join(', ')}`);
  };
  if (env.SMS_PROVIDER === 'twilio') {
    need('SMS_PROVIDER=twilio', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
    if (!env.TWILIO_FROM && !env.TWILIO_MESSAGING_SERVICE_SID)
      throw new Error('SMS_PROVIDER=twilio requires TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
  }
  if (env.EMAIL_PROVIDER === 'smtp') need('EMAIL_PROVIDER=smtp', ['SMTP_HOST']);
  if (env.PUSH_DRIVER === 'fcm') need('PUSH_DRIVER=fcm', ['FIREBASE_SERVICE_ACCOUNT']);
  if (env.STORAGE_DRIVER === 'r2')
    need('STORAGE_DRIVER=r2', [
      ...(env.R2_ENDPOINT ? [] : (['R2_ACCOUNT_ID'] as (keyof Env)[])),
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
    ]);
  if (env.PAYMENT_PROVIDER === 'CAMPAY' && !env.CAMPAY_PERMANENT_TOKEN)
    need('PAYMENT_PROVIDER=CAMPAY', ['CAMPAY_APP_USERNAME', 'CAMPAY_APP_PASSWORD']);
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
    console.warn(
      'WARNING: SMS_PROVIDER=console in production — OTP codes are logged, not delivered.',
    );
  }
  return env;
}
