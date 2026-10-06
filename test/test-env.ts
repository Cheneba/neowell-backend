/**
 * Environment for e2e tests. Imported before AppModule, because ConfigModule
 * reads and validates the environment when the module is first imported.
 */
export const FAKE_STT_PORT = 47123;
export const PAYMENTS_SECRET = 'test-payments-webhook-secret-0123456789abcd';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JOBS_ENABLED: 'false',
  PUSH_DRIVER: 'log',
  STT_URL: `http://127.0.0.1:${FAKE_STT_PORT}`,
  LIVEKIT_URL: 'wss://livekit.test.neowell.local',
  LIVEKIT_API_KEY: 'testkey',
  LIVEKIT_API_SECRET: 'testsecret-testsecret-testsecret-0123',
  PAYMENTS_WEBHOOK_SECRET: PAYMENTS_SECRET,
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR ?? '/tmp/neowell-e2e-uploads',
});
