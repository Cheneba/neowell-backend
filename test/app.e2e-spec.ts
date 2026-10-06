import { auth, babyBody, caregiver, createHarness, daysAgo, Harness } from './harness';

describe('NeoWell API — caregiver flows (e2e)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('GET /health', () => h.http().get('/health').expect(200, { status: 'ok', database: 'up' }));
  it('rejects unauthenticated requests', () => h.http().get('/babies').expect(401));

  describe('auth (FR-AUTH)', () => {
    it('signs up with OTP, rejects wrong/reused codes and rotates refresh tokens', async () => {
      const phone = h.newPhone();
      await h.http().post('/auth/otp/request').send({ phone }).expect(202);
      await h.http().post('/auth/otp/verify').send({ phone, code: '000000' }).expect(401);
      const first = await h
        .http()
        .post('/auth/otp/verify')
        .send({ phone, code: h.sms.last.get(phone) })
        .expect(200);
      expect(first.body.isNewUser).toBe(true);
      await h
        .http()
        .post('/auth/otp/verify')
        .send({ phone, code: h.sms.last.get(phone) })
        .expect(401);

      const rotated = await h
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);
      await h
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
      await h
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
    });

    it('never lets a user self-assign ADMIN', async () => {
      const phone = h.newPhone();
      await h.http().post('/auth/otp/request').send({ phone }).expect(202);
      await h
        .http()
        .post('/auth/otp/verify')
        .send({ phone, code: h.sms.last.get(phone), role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('profile and the 42-day naming rule (FR-ACC-01, FR-BABY-02)', () => {
    it('requires first and last name before adding a baby', async () => {
      const token = await h.login(h.newPhone());
      const me = await h.http().get('/me').set(auth(token)).expect(200);
      expect(me.body.profileComplete).toBe(false);
      const res = await h.http().post('/babies').set(auth(token)).send(babyBody()).expect(403);
      expect(res.body.code).toBe('PROFILE_INCOMPLETE');
      const updated = await h
        .http()
        .patch('/me')
        .set(auth(token))
        .send({ firstName: 'Christian', lastName: 'Ndi' })
        .expect(200);
      expect(updated.body.profileComplete).toBe(true);
      await h.http().post('/babies').set(auth(token)).send(babyBody()).expect(201);
    });

    it('names babies "Baby {mother}" under 42 days, numbers twins, and uses the given name later', async () => {
      const token = await caregiver(h, 'Achu');
      const twin1 = await h
        .http()
        .post('/babies')
        .set(auth(token))
        .send(babyBody({ givenName: 'Amara' }))
        .expect(201);
      expect(twin1.body.displayName).toBe('Baby Achu');
      expect(twin1.body.givenName).toBe('Amara');
      await h.http().post('/babies').set(auth(token)).send(babyBody()).expect(201);
      const older = await h
        .http()
        .post('/babies')
        .set(auth(token))
        .send(babyBody({ givenName: 'Bih', dateOfBirth: daysAgo(60) }))
        .expect(201);
      const unnamedOlder = await h
        .http()
        .post('/babies')
        .set(auth(token))
        .send(babyBody({ dateOfBirth: daysAgo(400) }))
        .expect(201);

      const list = await h.http().get('/babies').set(auth(token)).expect(200);
      const names = Object.fromEntries(
        list.body.map((b: { id: string; displayName: string }) => [b.id, b.displayName]),
      );
      // Everyone still called "Baby Achu" is numbered in birth order: the unnamed 400-day-old first, then the twins.
      expect(names[unnamedOlder.body.id]).toBe('Baby Achu 1');
      expect(names[twin1.body.id]).toBe('Baby Achu 2');
      expect(Object.values(names).sort()).toEqual([
        'Baby Achu 1',
        'Baby Achu 2',
        'Baby Achu 3',
        'Bih',
      ]);
      expect(names[older.body.id]).toBe('Bih');
      expect(list.body.find((b: { id: string }) => b.id === unnamedOlder.body.id).needsName).toBe(
        true,
      );
    });
  });

  describe('babies and growth (FR-BABY, FR-MEAS)', () => {
    let token: string;
    let babyId: string;

    beforeAll(async () => {
      token = await caregiver(h);
    });

    it('requires weight, length and head circumference', async () => {
      const { birthHeadCircumferenceCm: _hc, ...noHc } = babyBody();
      await h.http().post('/babies').set(auth(token)).send(noHc).expect(400);
      const { birthWeightGrams: _w, ...noWeight } = babyBody();
      await h.http().post('/babies').set(auth(token)).send(noWeight).expect(400);
    });

    it('classifies a preterm, low-birth-weight baby and stores the birth measurement', async () => {
      const res = await h
        .http()
        .post('/babies')
        .set(auth(token))
        .send(
          babyBody({
            gestationalAgeWeeks: 34,
            birthWeightGrams: 2200,
            birthLengthCm: 45,
            birthHeadCircumferenceCm: 31.5,
            dateOfBirth: daysAgo(20),
          }),
        )
        .expect(201);
      babyId = res.body.id;
      expect(res.body).toMatchObject({
        termStatus: 'MODERATE_LATE_PRETERM',
        birthWeightCategory: 'LBW',
        isHighRisk: true,
        correctedAgeDays: 20 - 42,
      });
      expect(res.body.riskFactors.map((r: { code: string }) => r.code)).toEqual([
        'PRETERM',
        'LOW_BIRTH_WEIGHT',
      ]);
      const ms = await h.http().get(`/babies/${babyId}/measurements`).set(auth(token)).expect(200);
      expect(ms.body).toHaveLength(1);
      expect(ms.body[0]).toMatchObject({
        source: 'BIRTH',
        weightGrams: 2200,
        lengthCm: 45,
        headCircumferenceCm: 31.5,
      });
    });

    it('flags a term baby with a head circumference outside the WHO range', async () => {
      const res = await h
        .http()
        .post('/babies')
        .set(auth(token))
        .send(babyBody({ birthHeadCircumferenceCm: 30 }))
        .expect(201);
      expect(res.body.riskFactors).toContainEqual({ code: 'BIRTH_HEAD_SIZE_OUT_OF_RANGE' });
    });

    it('adds measurements, pre-fill data and flags excess early weight loss', async () => {
      const term = await h
        .http()
        .post('/babies')
        .set(auth(token))
        .send(babyBody({ dateOfBirth: daysAgo(6) }))
        .expect(201);
      const res = await h
        .http()
        .post(`/babies/${term.body.id}/measurements`)
        .set(auth(token))
        .send({ measuredAt: daysAgo(1), weightGrams: 2800, source: 'CLINIC' })
        .expect(201);
      expect(res.body.growth.flags).toContainEqual({ code: 'EXCESS_WEIGHT_LOSS', level: 'YELLOW' });
      expect(res.body.growth.latest.weight).toMatchObject({
        value: 2800,
        unit: 'g',
        flag: 'NORMAL',
      });
      // Length/HC still come from the birth measurement (pre-fill source).
      expect(res.body.growth.latest.headCircumference.value).toBe(34);
      await h
        .http()
        .post(`/babies/${term.body.id}/measurements`)
        .set(auth(token))
        .send({ measuredAt: daysAgo(1), source: 'HOME' })
        .expect(400);
    });

    it('pauses home checks in kangaroo care and resumes them at discharge (FR-BABY-05)', async () => {
      await h
        .http()
        .patch(`/babies/${babyId}`)
        .set(auth(token))
        .send({ careStatus: 'KANGAROO_CARE' })
        .expect(200);
      const paused = await h
        .http()
        .get(`/babies/${babyId}/check-schedule`)
        .set(auth(token))
        .expect(200);
      expect(paused.body).toMatchObject({
        paused: true,
        pausedReason: 'KANGAROO_CARE',
        checksDue: 0,
        reminderTimes: [],
      });
      const home = await h
        .http()
        .patch(`/babies/${babyId}`)
        .set(auth(token))
        .send({ careStatus: 'AT_HOME' })
        .expect(200);
      expect(home.body.dischargeDate).toBeTruthy();
      const resumed = await h
        .http()
        .get(`/babies/${babyId}/check-schedule`)
        .set(auth(token))
        .expect(200);
      expect(resumed.body).toMatchObject({ paused: false, checksPerDay: 2 });
    });
  });

  describe('checks and triage (FR-CHK)', () => {
    let token: string;
    let infant: string; // 5 months old
    let newborn: string; // 3 days old

    beforeAll(async () => {
      token = await caregiver(h, 'Tanyi');
      infant = (
        await h
          .http()
          .post('/babies')
          .set(auth(token))
          .send(babyBody({ dateOfBirth: daysAgo(150) }))
          .expect(201)
      ).body.id;
      newborn = (
        await h
          .http()
          .post('/babies')
          .set(auth(token))
          .send(babyBody({ dateOfBirth: daysAgo(3) }))
          .expect(201)
      ).body.id;
    });

    it('serves a localized routine plan with core and rotating questions', async () => {
      const res = await h
        .http()
        .get(`/babies/${newborn}/check-plan?type=ROUTINE&lang=fr`)
        .set(auth(token))
        .expect(200);
      expect(res.body.questions[0]).toMatchObject({
        id: 'temperature',
        required: true,
        label: 'Température',
      });
      expect(res.body.questions.map((q: { id: string }) => q.id)).toEqual(
        expect.arrayContaining(['feedingQuality', 'convulsions', 'respiratoryRate']),
      );
    });

    it('serves an unwell plan for the chosen complaints', async () => {
      const res = await h
        .http()
        .get(`/babies/${newborn}/check-plan?type=UNWELL&complaints=BREATHING_PROBLEM,VOMITING`)
        .set(auth(token))
        .expect(200);
      const ids = res.body.questions.map((q: { id: string }) => q.id);
      expect(ids).toEqual(
        expect.arrayContaining(['temperature', 'respiratoryRate', 'chestIndrawing', 'vomiting']),
      );
    });

    it('requires data-collection consent and a temperature', async () => {
      const noConsent = await caregiver(h, 'Ewane', {
        dataCollection: false,
        clinicianShare: false,
      });
      const b = (await h.http().post('/babies').set(auth(noConsent)).send(babyBody()).expect(201))
        .body.id;
      const r = await h
        .http()
        .post(`/babies/${b}/observations`)
        .set(auth(noConsent))
        .send({ temperatureC: 36.8 })
        .expect(403);
      expect(r.body.code).toBe('CONSENT_REQUIRED');
      await h
        .http()
        .post(`/babies/${newborn}/observations`)
        .set(auth(token))
        .send({ feedingQuality: 'GOOD' })
        .expect(400);
    });

    it('makes any fever in a newborn RED with the no-medicines warning', async () => {
      const r = await h
        .http()
        .post(`/babies/${newborn}/observations`)
        .set(auth(token))
        .send({ temperatureC: 38.2, checkType: 'UNWELL', complaints: ['FEVER'] })
        .expect(201);
      expect(r.body.assessment.level).toBe('RED');
      expect(r.body.assessment.findings).toContainEqual({
        code: 'FEVER_YOUNG_INFANT',
        level: 'RED',
      });
      expect(r.body.assessment.actions).toEqual(
        expect.arrayContaining(['SEEK_CARE_NOW', 'NO_HOME_MEDICINES', 'COOLING_STEPS']),
      );
      expect(r.body.recheck).toBeNull();
      expect(r.body.observation.checkType).toBe('UNWELL');
    });

    it('cools then rechecks a moderate fever at 5 months, escalating when it persists (FR-CHK-08)', async () => {
      const first = await h
        .http()
        .post(`/babies/${infant}/observations`)
        .set(auth(token))
        .send({
          checkType: 'UNWELL',
          complaints: ['FEVER'],
          temperatureC: 38.4,
          roomFeel: 'HOT',
          clothing: 'HEAVY',
          feedingQuality: 'GOOD',
        })
        .expect(201);
      expect(first.body.assessment.level).toBe('YELLOW');
      expect(first.body.assessment.actions).toEqual(
        expect.arrayContaining(['COOLING_STEPS', 'COOL_ROOM', 'RECHECK_TEMP_30_MIN']),
      );
      expect(first.body.recheck).toBeTruthy();
      const recheckId = first.body.recheck.id;

      const schedule = await h
        .http()
        .get(`/babies/${infant}/check-schedule`)
        .set(auth(token))
        .expect(200);
      expect(schedule.body.pendingRecheck.id).toBe(recheckId);

      const second = await h
        .http()
        .post(`/babies/${infant}/observations`)
        .set(auth(token))
        .send({ checkType: 'UNWELL', recheckOfId: recheckId, temperatureC: 38.3 })
        .expect(201);
      expect(second.body.assessment.level).toBe('RED');
      expect(second.body.assessment.findings).toContainEqual({
        code: 'FEVER_PERSISTENT',
        level: 'RED',
      });
      const rechecks = await h
        .http()
        .get(`/babies/${infant}/rechecks?status=PENDING`)
        .set(auth(token))
        .expect(200);
      expect(rechecks.body).toEqual([]);
    });

    it('scores the breath count by age', async () => {
      const r = await h
        .http()
        .post(`/babies/${newborn}/observations`)
        .set(auth(token))
        .send({ temperatureC: 36.9, respiratoryRate: 66 })
        .expect(201);
      expect(r.body.assessment.findings).toContainEqual({ code: 'FAST_BREATHING', level: 'RED' });
    });

    it('makes offline re-sends idempotent with clientRef (FR-CHK-11)', async () => {
      const body = { temperatureC: 36.8, feedingQuality: 'GOOD', clientRef: 'offline-check-0001' };
      const a = await h
        .http()
        .post(`/babies/${newborn}/observations`)
        .set(auth(token))
        .send(body)
        .expect(201);
      const b = await h
        .http()
        .post(`/babies/${newborn}/observations`)
        .set(auth(token))
        .send(body)
        .expect(200);
      expect(b.body.observation.id).toBe(a.body.observation.id);
      expect(a.body.assessment.level).toBe('GREEN');
    });

    it('attaches a photo served through an expiring signed link (FR-CHK-12)', async () => {
      const obs = await h
        .http()
        .post(`/babies/${newborn}/observations`)
        .set(auth(token))
        .send({ temperatureC: 36.7 })
        .expect(201);
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      const res = await h
        .http()
        .post(`/babies/${newborn}/observations/${obs.body.observation.id}/photo`)
        .set(auth(token))
        .attach('file', png, { filename: 'cord.png', contentType: 'image/png' })
        .expect(201);
      const path = new URL(res.body.photoUrl).pathname;
      const file = await h.http().get(path).expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      await h
        .http()
        .get(path.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))
        .expect(404);
    });

    it('transcribes a voice note with the self-hosted speech service and detects complaints (FR-VOICE)', async () => {
      const res = await h
        .http()
        .post(`/babies/${newborn}/voice-notes`)
        .set(auth(token))
        .attach('file', Buffer.from('fake-audio'), {
          filename: 'note.m4a',
          contentType: 'audio/mp4',
        })
        .expect(201);
      expect(res.body.status).toBe('PENDING');
      await h.jobs.drain();
      const note = await h.http().get(`/voice-notes/${res.body.id}`).set(auth(token)).expect(200);
      expect(note.body).toMatchObject({
        status: 'TRANSCRIBED',
        transcript: 'The baby is very hot and keeps vomiting',
        detectedComplaints: ['FEVER', 'VOMITING'],
      });
      const obs = await h
        .http()
        .post(`/babies/${newborn}/observations`)
        .set(auth(token))
        .send({ temperatureC: 37, voiceNoteId: res.body.id, checkType: 'UNWELL' })
        .expect(201);
      expect(obs.body.observation.voiceNoteId).toBe(res.body.id);
    });

    it('builds the 7-day summary and the PDF (FR-RPT)', async () => {
      const s = await h
        .http()
        .get(`/babies/${newborn}/summary?days=7`)
        .set(auth(token))
        .expect(200);
      expect(s.body.baby.displayName).toBe('Baby Tanyi 2'); // the unnamed 5-month-old sibling is 1
      expect(s.body.totals.checks).toBeGreaterThanOrEqual(5);
      expect(s.body.totals.unwellChecks).toBeGreaterThanOrEqual(2);
      expect(s.body.growth.latest.weight.value).toBe(3200);
      const pdf = await h
        .http()
        .get(`/babies/${newborn}/summary.pdf?days=3&lang=fr`)
        .set(auth(token))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });

    it('rejects an unsupported summary window', () =>
      h.http().get(`/babies/${newborn}/summary?days=5`).set(auth(token)).expect(400));

    it('hides a baby from other caregivers', async () => {
      const other = await caregiver(h, 'Other');
      await h.http().get(`/babies/${newborn}`).set(auth(other)).expect(404);
      await h.http().get(`/babies/${newborn}/check-plan`).set(auth(other)).expect(404);
      await h.http().get(`/babies/${newborn}/growth`).set(auth(other)).expect(404);
    });
  });

  describe('facilities (FR-FAC)', () => {
    it('searches by name and lists the nearest newborn-capable facilities', async () => {
      const token = await caregiver(h);
      const tag = `e2e-${Date.now()}`;
      await h.prisma.facility.createMany({
        data: [
          { name: `${tag} far`, latitude: 6.2, longitude: 10.3, services: ['PAEDIATRICS'] },
          { name: `${tag} near`, latitude: 5.965, longitude: 10.15, services: ['NEONATOLOGY'] },
          { name: `${tag} maternity`, latitude: 5.96, longitude: 10.146, services: ['MATERNITY'] },
        ],
      });
      const near = await h
        .http()
        .get('/facilities/nearby?lat=5.96&lon=10.145&radiusKm=60')
        .set(auth(token))
        .expect(200);
      const ours = near.body
        .filter((f: { name: string }) => f.name.startsWith(tag))
        .map((f: { name: string }) => f.name);
      expect(ours).toEqual([`${tag} near`, `${tag} far`]);
      const search = await h.http().get(`/facilities?q=${tag}`).set(auth(token)).expect(200);
      expect(search.body).toHaveLength(3);
      await h
        .http()
        .post('/facilities')
        .set(auth(token))
        .send({ name: 'x', latitude: 1, longitude: 1, services: ['OPD'] })
        .expect(403);
    });
  });

  describe('account (FR-ACC)', () => {
    it('exports data, deletes the account and purges it after 30 days', async () => {
      const phone = h.newPhone();
      const token = await h.login(phone);
      await h
        .http()
        .patch('/me')
        .set(auth(token))
        .send({ firstName: 'Delete', lastName: 'Me' })
        .expect(200);
      await h
        .http()
        .put('/me/consents')
        .set(auth(token))
        .send({ dataCollection: true })
        .expect(200);
      const baby = (await h.http().post('/babies').set(auth(token)).send(babyBody()).expect(201))
        .body.id;
      await h
        .http()
        .post(`/babies/${baby}/observations`)
        .set(auth(token))
        .send({ temperatureC: 36.8 })
        .expect(201);

      const exported = await h.http().get('/me/export').set(auth(token)).expect(200);
      expect(exported.body.babies[0].observations).toHaveLength(1);
      expect(exported.body.babies[0].measurements).toHaveLength(1);

      const del = await h.http().delete('/me').set(auth(token)).expect(202);
      expect(new Date(del.body.purgeAfter).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
      await h.http().get('/me').set(auth(token)).expect(401);

      const { MaintenanceService } = await import('../src/scheduler/maintenance.service');
      const maintenance = h.app.get(MaintenanceService);
      await h.prisma.user.update({
        where: { phone },
        data: { deletionRequestedAt: new Date(Date.now() - 31 * 86_400_000) },
      });
      expect(await maintenance.purgeAccounts()).toBeGreaterThanOrEqual(1);
      expect(await h.prisma.user.findUnique({ where: { phone } })).toBeNull();
      expect(await h.prisma.baby.findUnique({ where: { id: baby } })).toBeNull();
    });
  });
});
