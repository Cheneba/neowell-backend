import { FAKE_STT_PORT, PAYMENTS_SECRET } from './test-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { createServer, Server } from 'node:http';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { JobsService } from '../src/jobs/jobs.service';
import { SmsService } from '../src/notifications/sms.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

/** Captures outgoing SMS so tests can read OTP codes. */
export class CapturingSms extends SmsService {
  last = new Map<string, string>();
  all: { phone: string; message: string }[] = [];
  async send(phone: string, message: string) {
    this.all.push({ phone, message });
    const code = message.match(/\b\d{6}\b/);
    if (code) this.last.set(phone, code[0]);
  }
}

/** A stand-in for the self-hosted speech-to-text service (OpenAI-compatible). */
function startFakeStt(): Promise<Server> {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ text: 'The baby is very hot and keeps vomiting', language: 'en' }));
    });
  });
  return new Promise((resolve) => server.listen(FAKE_STT_PORT, '127.0.0.1', () => resolve(server)));
}

export interface Harness {
  app: INestApplication<App>;
  prisma: PrismaService;
  jobs: JobsService;
  sms: CapturingSms;
  http: () => ReturnType<typeof request>;
  login: (phone: string, role?: 'CAREGIVER' | 'CLINICIAN') => Promise<string>;
  newPhone: () => string;
  sign: (body: string) => string;
  close: () => Promise<void>;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
export { PAYMENTS_SECRET };

export async function createHarness(): Promise<Harness> {
  const stt = await startFakeStt();
  const sms = new CapturingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SmsService)
    .useValue(sms)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ rawBody: true });
  setupApp(app);
  await app.init();
  const http = () => request(app.getHttpServer());
  let seq = 0;
  const newPhone = () => `+2376${String(Date.now()).slice(-6)}${String(++seq).padStart(2, '0')}`;

  return {
    app,
    prisma: app.get(PrismaService),
    jobs: app.get(JobsService),
    sms,
    http,
    newPhone,
    sign: (body) => createHmac('sha256', PAYMENTS_SECRET).update(body).digest('hex'),
    async login(phone, role) {
      await http().post('/auth/otp/request').send({ phone }).expect(202);
      const res = await http()
        .post('/auth/otp/verify')
        .send({ phone, code: sms.last.get(phone), role })
        .expect(200);
      return res.body.accessToken as string;
    },
    async close() {
      await app.close();
      await new Promise((r) => stt.close(r));
    },
  };
}

/** Signs in a caregiver with a completed profile and consents. */
export async function caregiver(
  h: Harness,
  lastName = 'Fon',
  consents = { dataCollection: true, clinicianShare: true },
) {
  const token = await h.login(h.newPhone());
  await h
    .http()
    .patch('/me')
    .set(auth(token))
    .send({ firstName: 'Christian', lastName })
    .expect(200);
  await h.http().put('/me/consents').set(auth(token)).send(consents).expect(200);
  return token;
}

export const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

export const babyBody = (over: Record<string, unknown> = {}) => ({
  sex: 'FEMALE',
  dateOfBirth: daysAgo(5),
  gestationalAgeWeeks: 39,
  birthWeightGrams: 3200,
  birthLengthCm: 49.5,
  birthHeadCircumferenceCm: 34,
  ...over,
});
