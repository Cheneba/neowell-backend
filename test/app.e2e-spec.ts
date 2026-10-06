import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SmsService } from '../src/notifications/sms.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

/** Captures outgoing SMS so tests can read OTP codes. */
class CapturingSms extends SmsService {
  last = new Map<string, string>();
  async send(phone: string, message: string) {
    this.last.set(phone, message.match(/\d{6}/)![0]);
  }
}

describe('NeoWell API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSms();
  const http = () => request(app.getHttpServer());

  let phoneSeq = 0;
  const newPhone = () =>
    `+23767${String(Date.now()).slice(-5)}${String(++phoneSeq).padStart(2, '0')}`;

  async function login(phone: string, role?: 'CAREGIVER' | 'CLINICIAN') {
    await http().post('/auth/otp/request').send({ phone }).expect(202);
    const res = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: sms.last.get(phone), role })
      .expect(200);
    return res.body as { accessToken: string; refreshToken: string; isNewUser: boolean };
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health', () => http().get('/health').expect(200, { status: 'ok', database: 'up' }));

  it('rejects unauthenticated requests', () => http().get('/babies').expect(401));

  describe('auth', () => {
    it('signs up with OTP, rejects a wrong code, and rotates refresh tokens', async () => {
      const phone = newPhone();
      await http().post('/auth/otp/request').send({ phone }).expect(202);
      await http().post('/auth/otp/verify').send({ phone, code: '000000' }).expect(401);

      const first = await http()
        .post('/auth/otp/verify')
        .send({ phone, code: sms.last.get(phone) })
        .expect(200);
      expect(first.body.isNewUser).toBe(true);

      // A consumed code cannot be reused.
      await http()
        .post('/auth/otp/verify')
        .send({ phone, code: sms.last.get(phone) })
        .expect(401);

      const me = await http().get('/me').set(auth(first.body.accessToken)).expect(200);
      expect(me.body).toMatchObject({ phone, role: 'CAREGIVER' });

      const rotated = await http()
        .post('/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);
      // Reusing the old refresh token is treated as theft and revokes the new one too.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
    });

    it('rejects a malformed phone number', () =>
      http().post('/auth/otp/request').send({ phone: '670000000' }).expect(400));

    it('never lets a user self-assign ADMIN', async () => {
      const phone = newPhone();
      await http().post('/auth/otp/request').send({ phone }).expect(202);
      await http()
        .post('/auth/otp/verify')
        .send({ phone, code: sms.last.get(phone), role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('caregiver flow', () => {
    let token: string;
    let babyId: string;

    beforeAll(async () => {
      token = (await login(newPhone())).accessToken;
    });

    it('creates a baby profile', async () => {
      const dob = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const res = await http()
        .post('/babies')
        .set(auth(token))
        .send({ name: 'Amara', dateOfBirth: dob, birthWeightGrams: 3100, gestationalAgeWeeks: 39 })
        .expect(201);
      babyId = res.body.id;
      expect(res.body.isHighRisk).toBe(false);
    });

    it('rejects a baby born in the future', () =>
      http()
        .post('/babies')
        .set(auth(token))
        .send({ name: 'X', dateOfBirth: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(400));

    it('requires data-collection consent before recording a check', async () => {
      const res = await http()
        .post(`/babies/${babyId}/observations`)
        .set(auth(token))
        .send({ temperatureC: 36.8 })
        .expect(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
      await http().put('/me/consents').set(auth(token)).send({ dataCollection: true }).expect(200);
    });

    it('returns GREEN for a well baby', async () => {
      const res = await http()
        .post(`/babies/${babyId}/observations`)
        .set(auth(token))
        .send({
          temperatureC: 36.8,
          feedingCount24h: 10,
          feedingQuality: 'GOOD',
          breathing: 'NORMAL',
        })
        .expect(201);
      expect(res.body.assessment.level).toBe('GREEN');
      expect(res.body.observation.temperatureC).toBe(36.8);
    });

    it('returns RED with care actions for fever', async () => {
      const res = await http()
        .post(`/babies/${babyId}/observations`)
        .set(auth(token))
        .send({ temperatureC: 38.4 })
        .expect(201);
      expect(res.body.assessment.level).toBe('RED');
      expect(res.body.assessment.findings).toContainEqual({ code: 'FEVER', level: 'RED' });
      expect(res.body.assessment.actions[0]).toBe('SEEK_CARE_NOW');
    });

    it('rejects unknown fields and out-of-range values', async () => {
      await http()
        .post(`/babies/${babyId}/observations`)
        .set(auth(token))
        .send({ temperatureC: 50 })
        .expect(400);
      await http()
        .post(`/babies/${babyId}/observations`)
        .set(auth(token))
        .send({ riskLevel: 'GREEN' })
        .expect(400);
    });

    it('reports the check schedule for a 3-day-old (3 checks/day)', async () => {
      const res = await http().get(`/babies/${babyId}/check-schedule`).set(auth(token)).expect(200);
      expect(res.body).toMatchObject({ checksPerDay: 3, checksLast24h: 2, checksDue: 1 });
    });

    it('rejects an unsupported summary window', () =>
      http().get(`/babies/${babyId}/summary?days=5`).set(auth(token)).expect(400));

    it('builds a 3-day summary', async () => {
      const res = await http().get(`/babies/${babyId}/summary?days=3`).set(auth(token)).expect(200);
      expect(res.body.period.days).toBe(3);
      expect(res.body.totals).toMatchObject({ checks: 2, green: 1, red: 1 });
      expect(res.body.temperature).toEqual({ min: 36.8, max: 38.4, latest: 38.4 });
      expect(res.body.latestRiskLevel).toBe('RED');
    });

    it('hides a baby from other caregivers', async () => {
      const other = (await login(newPhone())).accessToken;
      await http().get(`/babies/${babyId}`).set(auth(other)).expect(404);
      await http().get(`/babies/${babyId}/observations`).set(auth(other)).expect(404);
    });

    it('writes an audit log entry for checks', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { action: 'POST /babies/:babyId/observations' },
      });
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('facilities', () => {
    it('lists the nearest newborn-capable facilities first', async () => {
      const { accessToken } = await login(newPhone());
      const tag = `e2e-${Date.now()}`;
      await prisma.facility.createMany({
        data: [
          { name: `${tag} far`, latitude: 6.2, longitude: 10.3, services: ['PAEDIATRICS'] },
          { name: `${tag} near`, latitude: 5.965, longitude: 10.15, services: ['NEONATOLOGY'] },
          { name: `${tag} maternity`, latitude: 5.96, longitude: 10.146, services: ['MATERNITY'] },
        ],
      });
      const res = await http()
        .get('/facilities/nearby?lat=5.96&lon=10.145&radiusKm=60')
        .set(auth(accessToken))
        .expect(200);
      const ours = res.body.filter((f: { name: string }) => f.name.startsWith(tag));
      expect(ours.map((f: { name: string }) => f.name)).toEqual([`${tag} near`, `${tag} far`]);
      expect(ours[0].distanceKm).toBeLessThan(1);
    });

    it('only lets admins create facilities', async () => {
      const { accessToken } = await login(newPhone());
      await http()
        .post('/facilities')
        .set(auth(accessToken))
        .send({ name: 'x', latitude: 1, longitude: 1, services: ['OPD'] })
        .expect(403);
    });
  });

  describe('clinician verification and teleconsultation', () => {
    let clinicianToken: string;
    let clinicianId: string;
    let adminToken: string;
    let caregiverToken: string;
    let babyId: string;
    let consultationId: string;
    const slot = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    slot.setUTCMinutes(0, 0, 0);

    beforeAll(async () => {
      clinicianToken = (await login(newPhone(), 'CLINICIAN')).accessToken;

      const adminPhone = newPhone();
      await prisma.user.create({ data: { phone: adminPhone, role: 'ADMIN' } });
      adminToken = (await login(adminPhone)).accessToken;

      caregiverToken = (await login(newPhone())).accessToken;
      babyId = (
        await http()
          .post('/babies')
          .set(auth(caregiverToken))
          .send({ name: 'Bih', dateOfBirth: new Date(Date.now() - 20 * 86_400_000).toISOString() })
          .expect(201)
      ).body.id;
    });

    it('registers a clinician profile, which starts unverified', async () => {
      const res = await http()
        .post('/clinicians/me')
        .set(auth(clinicianToken))
        .send({
          fullName: 'Dr. Ngwa',
          licenseNumber: `LIC-${Date.now()}`,
          specialties: ['NEONATOLOGY'],
          consultationFeeXaf: 5000,
        })
        .expect(201);
      clinicianId = res.body.id;
      expect(res.body.verificationStatus).toBe('PENDING_DOCUMENTS');

      await http()
        .put('/clinicians/me/availability')
        .set(auth(clinicianToken))
        .send({
          slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d,
            startMinute: 0,
            endMinute: 1440,
          })),
        })
        .expect(200);
    });

    it('caregivers cannot register as clinicians', () =>
      http()
        .post('/clinicians/me')
        .set(auth(caregiverToken))
        .send({ fullName: 'x', licenseNumber: 'y', specialties: [], consultationFeeXaf: 1 })
        .expect(403));

    it('rejects disallowed document types', () =>
      http()
        .post('/clinicians/me/documents')
        .set(auth(clinicianToken))
        .field('type', 'MEDICAL_LICENSE')
        .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
        .expect(400));

    it('rejects files whose content does not match the declared type', () =>
      http()
        .post('/clinicians/me/documents')
        .set(auth(clinicianToken))
        .field('type', 'MEDICAL_LICENSE')
        .attach('file', Buffer.from('<?php echo 1;?>'), {
          filename: 'shell.php',
          contentType: 'application/pdf',
        })
        .expect(400));

    it('rejects overlapping availability slots', () =>
      http()
        .put('/clinicians/me/availability')
        .set(auth(clinicianToken))
        .send({
          slots: [
            { dayOfWeek: 1, startMinute: 540, endMinute: 600 },
            { dayOfWeek: 1, startMinute: 560, endMinute: 620 },
          ],
        })
        .expect(400));

    it('moves to PENDING_REVIEW once all three documents are uploaded', async () => {
      for (const type of ['MEDICAL_LICENSE', 'MEDICAL_DEGREE', 'EMPLOYMENT_PROOF']) {
        await http()
          .post('/clinicians/me/documents')
          .set(auth(clinicianToken))
          .field('type', type)
          .attach('file', Buffer.from('%PDF-1.4 test'), {
            filename: `${type}.pdf`,
            contentType: 'application/pdf',
          })
          .expect(201);
      }
      const me = await http().get('/clinicians/me').set(auth(clinicianToken)).expect(200);
      expect(me.body.verificationStatus).toBe('PENDING_REVIEW');
      expect(me.body.missingDocuments).toEqual([]);
    });

    it('is not bookable before verification', async () => {
      await http().get(`/clinicians/${clinicianId}`).set(auth(caregiverToken)).expect(404);
    });

    it('is verified by an admin, not by the clinician', async () => {
      await http()
        .post(`/clinicians/${clinicianId}/review`)
        .set(auth(clinicianToken))
        .send({ decision: 'VERIFIED' })
        .expect(403);
      const queue = await http().get('/clinicians/review-queue').set(auth(adminToken)).expect(200);
      expect(queue.body.map((c: { id: string }) => c.id)).toContain(clinicianId);
      await http()
        .post(`/clinicians/${clinicianId}/review`)
        .set(auth(adminToken))
        .send({ decision: 'VERIFIED' })
        .expect(201);
      await http().get(`/clinicians/${clinicianId}`).set(auth(caregiverToken)).expect(200);
    });

    it('requires clinician-sharing consent to book', async () => {
      const res = await http()
        .post('/consultations')
        .set(auth(caregiverToken))
        .send({ babyId, clinicianId, type: 'VIDEO', scheduledAt: slot.toISOString() })
        .expect(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
    });

    it('books a consultation with a pre-visit summary and commission', async () => {
      await http()
        .put('/me/consents')
        .set(auth(caregiverToken))
        .send({ dataCollection: true, clinicianShare: true })
        .expect(200);
      const res = await http()
        .post('/consultations')
        .set(auth(caregiverToken))
        .send({
          babyId,
          clinicianId,
          type: 'VIDEO',
          scheduledAt: slot.toISOString(),
          reason: 'Fever',
        })
        .expect(201);
      consultationId = res.body.id;
      expect(res.body).toMatchObject({ status: 'REQUESTED', feeXaf: 5000, commissionXaf: 750 });
      expect(res.body.previsitSummary.period.days).toBe(7);
    });

    it('refuses a double booking of the same slot', () =>
      http()
        .post('/consultations')
        .set(auth(caregiverToken))
        .send({ babyId, clinicianId, type: 'AUDIO', scheduledAt: slot.toISOString() })
        .expect(409));

    it('lets the clinician see the summary and confirm, but not the caregiver', async () => {
      const seen = await http()
        .get(`/consultations/${consultationId}`)
        .set(auth(clinicianToken))
        .expect(200);
      expect(seen.body.previsitSummary.baby.name).toBe('Bih');

      await http()
        .patch(`/consultations/${consultationId}/status`)
        .set(auth(caregiverToken))
        .send({ status: 'CONFIRMED' })
        .expect(400);
      const ok = await http()
        .patch(`/consultations/${consultationId}/status`)
        .set(auth(clinicianToken))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      expect(ok.body.status).toBe('CONFIRMED');
    });

    it('hides the consultation from unrelated users', async () => {
      const stranger = (await login(newPhone())).accessToken;
      await http().get(`/consultations/${consultationId}`).set(auth(stranger)).expect(404);
    });
  });
});
