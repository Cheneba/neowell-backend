import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_SECRET: 'b'.repeat(32),
  FILE_URL_SECRET: 'c'.repeat(32),
  PAYMENTS_WEBHOOK_SECRET: 'd'.repeat(32),
};

describe('validateEnv drivers', () => {
  it('accepts the defaults', () => expect(() => validateEnv(base)).not.toThrow());
  it.each([
    [{ SMS_PROVIDER: 'twilio' }, 'TWILIO_ACCOUNT_SID'],
    [{ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b' }, 'TWILIO_FROM'],
    [{ EMAIL_PROVIDER: 'smtp' }, 'SMTP_HOST'],
    [{ PUSH_DRIVER: 'fcm' }, 'FIREBASE_SERVICE_ACCOUNT'],
    [{ STORAGE_DRIVER: 'r2' }, 'R2_BUCKET'],
    [{ PAYMENT_PROVIDER: 'CAMPAY' }, 'CAMPAY_APP_USERNAME'],
  ])('rejects %j without credentials', (extra, missing) =>
    expect(() => validateEnv({ ...base, ...extra })).toThrow(missing),
  );
  it('accepts a fully configured Twilio driver', () =>
    expect(() =>
      validateEnv({
        ...base,
        SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'a',
        TWILIO_AUTH_TOKEN: 'b',
        TWILIO_FROM: '+1555',
        NODE_ENV: 'production',
      }),
    ).not.toThrow());
});
