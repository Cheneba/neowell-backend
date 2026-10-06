import { AdminService } from '../src/admin/admin.service';
import { ConsultationsService } from '../src/consultations/consultations.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { auth, babyBody, caregiver, createHarness, daysAgo, Harness } from './harness';

const PDF = Buffer.from('%PDF-1.4 test');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('NeoWell API — clinicians & consultations (e2e)', () => {
  let h: Harness;
  let admin: string;
  let doctor: string;
  let doctorUserId: string;
  let clinicianId: string;
  let mother: string;
  let babyId: string;
  let feverCheckId: string;

  /** Books a consultation and pays it with the sandbox; returns its id. */
  async function bookAndPay(body: Record<string, unknown>, payerPhone = '+237670000001') {
    const booked = await h
      .http()
      .post('/consultations')
      .set(auth(mother))
      .send({ babyId, clinicianId, ...body })
      .expect(201);
    expect(booked.body.status).toBe('AWAITING_PAYMENT');
    await h
      .http()
      .post(`/consultations/${booked.body.id}/payments`)
      .set(auth(mother))
      .send({ provider: 'MTN_MOMO', payerPhone })
      .expect(201);
    await h.jobs.drain();
    return booked.body.id as string;
  }

  beforeAll(async () => {
    h = await createHarness();
    const adminPhone = h.newPhone();
    await h.prisma.user.create({
      data: { phone: adminPhone, role: 'ADMIN', firstName: 'Ada', lastName: 'Admin' },
    });
    admin = await h.login(adminPhone);

    const doctorPhone = h.newPhone();
    doctor = await h.login(doctorPhone, 'CLINICIAN');
    doctorUserId = (await h.prisma.user.findUniqueOrThrow({ where: { phone: doctorPhone } })).id;

    mother = await caregiver(h, 'Christian');
    babyId = (
      await h
        .http()
        .post('/babies')
        .set(auth(mother))
        .send(babyBody({ dateOfBirth: daysAgo(10) }))
        .expect(201)
    ).body.id;
    feverCheckId = (
      await h
        .http()
        .post(`/babies/${babyId}/observations`)
        .set(auth(mother))
        .send({ temperatureC: 38.3, checkType: 'UNWELL', complaints: ['FEVER'] })
        .expect(201)
    ).body.observation.id;
  });
  afterAll(() => h.close());

  describe('clinician onboarding (FR-CLIN)', () => {
    it('registers with per-medium fees and starts unverified', async () => {
      const res = await h
        .http()
        .post('/clinicians/me')
        .set(auth(doctor))
        .send({
          firstName: 'Amina',
          lastName: 'Ngwa',
          licenseNumber: `LIC-${Date.now()}`,
          specialties: ['NEONATOLOGY'],
          yearsExperience: 9,
          feeChatXaf: 2000,
          feeAudioXaf: 4000,
          feeVideoXaf: 6000,
          payoutProvider: 'MTN_MOMO',
          payoutPhone: '+237670009999',
        })
        .expect(201);
      clinicianId = res.body.id;
      expect(res.body).toMatchObject({
        verificationStatus: 'PENDING_DOCUMENTS',
        displayName: 'Dr Amina N.',
      });
      expect(res.body.missingForReview).toEqual([
        'MEDICAL_LICENSE',
        'MEDICAL_DEGREE',
        'EMPLOYMENT_PROOF',
        'PHOTO',
      ]);
      await h
        .http()
        .put('/clinicians/me/availability')
        .set(auth(doctor))
        .send({
          slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d,
            startMinute: 0,
            endMinute: 1440,
          })),
        })
        .expect(200);
    });

    it('rejects files whose content does not match the declared type', async () => {
      await h
        .http()
        .post('/clinicians/me/documents')
        .set(auth(doctor))
        .field('type', 'MEDICAL_LICENSE')
        .attach('file', Buffer.from('<?php echo 1;?>'), {
          filename: 'shell.php',
          contentType: 'application/pdf',
        })
        .expect(400);
      await h
        .http()
        .post('/clinicians/me/photo')
        .set(auth(doctor))
        .attach('file', Buffer.from('not an image'), {
          filename: 'me.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('rejects overlapping availability slots', () =>
      h
        .http()
        .put('/clinicians/me/availability')
        .set(auth(doctor))
        .send({
          slots: [
            { dayOfWeek: 1, startMinute: 540, endMinute: 600 },
            { dayOfWeek: 1, startMinute: 560, endMinute: 620 },
          ],
        })
        .expect(400));

    it('needs a photo and the three documents before review', async () => {
      for (const type of ['MEDICAL_LICENSE', 'MEDICAL_DEGREE', 'EMPLOYMENT_PROOF']) {
        await h
          .http()
          .post('/clinicians/me/documents')
          .set(auth(doctor))
          .field('type', type)
          .attach('file', PDF, { filename: `${type}.pdf`, contentType: 'application/pdf' })
          .expect(201);
      }
      expect((await h.http().get('/clinicians/me').set(auth(doctor))).body.verificationStatus).toBe(
        'PENDING_DOCUMENTS',
      );
      await h
        .http()
        .post('/clinicians/me/photo')
        .set(auth(doctor))
        .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' })
        .expect(201);
      expect((await h.http().get('/clinicians/me').set(auth(doctor))).body.verificationStatus).toBe(
        'PENDING_REVIEW',
      );
    });

    it('is verified by an admin, who sees the documents through signed links', async () => {
      await h
        .http()
        .post(`/admin/clinicians/${clinicianId}/review`)
        .set(auth(doctor))
        .send({ decision: 'VERIFIED' })
        .expect(403);
      const queue = await h
        .http()
        .get('/admin/clinicians?status=PENDING_REVIEW')
        .set(auth(admin))
        .expect(200);
      const mine = queue.body.find((c: { id: string }) => c.id === clinicianId);
      expect(mine.documents).toHaveLength(3);
      await h.http().get(new URL(mine.documents[0].url).pathname).expect(200);
      await h
        .http()
        .post(`/admin/clinicians/${clinicianId}/review`)
        .set(auth(admin))
        .send({ decision: 'VERIFIED' })
        .expect(201);
    });

    it('shows a public profile without any contact details (FR-CLIN-05)', async () => {
      const res = await h.http().get(`/clinicians/${clinicianId}`).set(auth(mother)).expect(200);
      expect(res.body).toMatchObject({
        displayName: 'Dr Amina N.',
        verified: true,
        media: { CHAT: 2000, AUDIO: 4000, VIDEO: 6000 },
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('+237');
      expect(text).not.toContain('Ngwa');
      expect(res.body.photoUrl).toMatch(/\/files\//);
    });
  });

  describe('booking, payment and the consultation room (FR-CONS, FR-PAY)', () => {
    let scheduledId: string;
    let slot: string;

    it('requires clinician-sharing consent to book', async () => {
      const noShare = await caregiver(h, 'Mbah', { dataCollection: true, clinicianShare: false });
      const b = (await h.http().post('/babies').set(auth(noShare)).send(babyBody()).expect(201))
        .body.id;
      const res = await h
        .http()
        .post('/consultations')
        .set(auth(noShare))
        .send({ babyId: b, clinicianId, medium: 'CHAT', timing: 'ASAP' })
        .expect(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
    });

    it('lists free slots and books a scheduled chat with a fever checklist', async () => {
      const slots = await h
        .http()
        .get(`/clinicians/${clinicianId}/slots?days=2`)
        .set(auth(mother))
        .expect(200);
      slot = slots.body.slots[2];
      const res = await h
        .http()
        .post('/consultations')
        .set(auth(mother))
        .send({
          babyId,
          clinicianId,
          medium: 'CHAT',
          timing: 'SCHEDULED',
          scheduledAt: slot,
          reason: 'Fever since this morning',
          observationId: feverCheckId,
          preConsultChecklist: {
            removedClothes: true,
            cooledRoom: true,
            sponged: false,
            rechecked: true,
          },
        })
        .expect(201);
      scheduledId = res.body.id;
      expect(res.body).toMatchObject({
        status: 'AWAITING_PAYMENT',
        feeXaf: 2000,
        paymentStatus: 'UNPAID',
      });
      expect(res.body.commissionXaf).toBeUndefined(); // caregiver view
      const again = await h
        .http()
        .get(`/clinicians/${clinicianId}/slots?days=2`)
        .set(auth(mother))
        .expect(200);
      expect(again.body.slots).not.toContain(slot);
    });

    it('hides unpaid bookings from the clinician', async () => {
      await h.http().get(`/consultations/${scheduledId}`).set(auth(doctor)).expect(404);
    });

    it('lets the payer retry after a failed payment', async () => {
      await h
        .http()
        .post(`/consultations/${scheduledId}/payments`)
        .set(auth(mother))
        .send({ provider: 'ORANGE_MONEY', payerPhone: '+237690000000' })
        .expect(201);
      await h.jobs.drain();
      const failed = await h
        .http()
        .get(`/consultations/${scheduledId}`)
        .set(auth(mother))
        .expect(200);
      expect(failed.body).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'FAILED' });

      await h
        .http()
        .post(`/consultations/${scheduledId}/payments`)
        .set(auth(mother))
        .send({ provider: 'MTN_MOMO', payerPhone: '+237670000001' })
        .expect(201);
      await h.jobs.drain();
      const paid = await h
        .http()
        .get(`/consultations/${scheduledId}`)
        .set(auth(mother))
        .expect(200);
      expect(paid.body).toMatchObject({ status: 'REQUESTED', paymentStatus: 'PAID' });
      expect(new Date(paid.body.acceptDeadline).toISOString()).toBe(slot);
    });

    it('gives the clinician the request, summary and checklist, but never the phone (FR-CONS-06/08)', async () => {
      const res = await h.http().get(`/consultations/${scheduledId}`).set(auth(doctor)).expect(200);
      expect(res.body.caregiver).toEqual({ firstName: 'Christian', lastName: 'Christian' });
      expect(res.body.baby.displayName).toBe('Baby Christian');
      expect(res.body.previsitSummary.totals.unwellChecks).toBe(1);
      expect(res.body.preConsultChecklist).toEqual({
        removedClothes: true,
        cooledRoom: true,
        sponged: false,
        rechecked: true,
      });
      expect(res.body).toMatchObject({ commissionXaf: 300, clinicianEarningXaf: 1700 });
      expect(JSON.stringify(res.body)).not.toMatch(/\+237/);
      const audit = await h.prisma.auditLog.count({
        where: { userId: doctorUserId, action: 'READ consultation', entityId: scheduledId },
      });
      expect(audit).toBe(1);
      const inbox = await h.http().get('/me/notifications').set(auth(doctor)).expect(200);
      expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('CONSULT_REQUESTED');
    });

    it('opens the chat on acceptance, starts with the report, and masks contact details', async () => {
      await h
        .http()
        .post(`/consultations/${scheduledId}/messages`)
        .set(auth(mother))
        .send({ body: 'hello?' })
        .expect(409);
      await h.http().post(`/consultations/${scheduledId}/accept`).set(auth(mother)).expect(403);
      const accepted = await h
        .http()
        .post(`/consultations/${scheduledId}/accept`)
        .set(auth(doctor))
        .expect(200);
      expect(accepted.body).toMatchObject({
        status: 'CONFIRMED',
        chatOpen: true,
        canJoinCall: false,
      });

      const sent = await h
        .http()
        .post(`/consultations/${scheduledId}/messages`)
        .set(auth(mother))
        .send({ body: 'Please call me on 6 70 12 34 56 or WhatsApp' })
        .expect(201);
      expect(sent.body).toMatchObject({
        body: 'Please call me on [contact hidden] or WhatsApp',
        contactMasked: true,
        mine: true,
      });
      await h
        .http()
        .post(`/consultations/${scheduledId}/messages/image`)
        .set(auth(mother))
        .attach('file', PNG, { filename: 'rash.png', contentType: 'image/png' })
        .expect(201);

      const msgs = await h
        .http()
        .get(`/consultations/${scheduledId}/messages`)
        .set(auth(doctor))
        .expect(200);
      expect(msgs.body.map((m: { kind: string }) => m.kind)).toEqual([
        'REPORT',
        'SYSTEM',
        'TEXT',
        'IMAGE',
      ]);
      expect(msgs.body[2]).toMatchObject({ mine: false, senderRole: 'CAREGIVER' });
      const list = await h.http().get('/consultations').set(auth(doctor)).expect(200);
      expect(list.body.find((c: { id: string }) => c.id === scheduledId).unreadCount).toBe(2);
      await h
        .http()
        .post(`/consultations/${scheduledId}/messages/read`)
        .set(auth(doctor))
        .send({ upToId: msgs.body[3].id })
        .expect(204);
      const after = await h
        .http()
        .get(`/consultations/${scheduledId}/messages?after=${msgs.body[2].id}`)
        .set(auth(doctor))
        .expect(200);
      expect(after.body).toHaveLength(1);
      expect(after.body[0].readAt).toBeTruthy();
    });

    it('lets the caregiver cancel ≥ 1 h before start with a full refund (FR-CONS-10)', async () => {
      const res = await h
        .http()
        .post(`/consultations/${scheduledId}/cancel`)
        .set(auth(mother))
        .send({ reason: 'Baby is better' })
        .expect(200);
      expect(res.body.status).toBe('CANCELLED');
      await h.jobs.drain();
      const after = await h
        .http()
        .get(`/consultations/${scheduledId}`)
        .set(auth(mother))
        .expect(200);
      expect(after.body.paymentStatus).toBe('REFUNDED');
      const refunds = await h.prisma.payment.findMany({
        where: { consultationId: scheduledId, kind: 'REFUND' },
      });
      expect(refunds).toHaveLength(1);
    });
  });

  describe('ASAP video consultation with outcomes', () => {
    let id: string;

    it('requires the clinician to be available now', async () => {
      await h
        .http()
        .post('/consultations')
        .set(auth(mother))
        .send({ babyId, clinicianId, medium: 'VIDEO', timing: 'ASAP' })
        .expect(400);
      const res = await h
        .http()
        .put('/clinicians/me/available-now')
        .set(auth(doctor))
        .send({ minutes: 60 })
        .expect(200);
      expect(new Date(res.body.availableNowUntil).getTime()).toBeGreaterThan(Date.now());
      const listed = await h
        .http()
        .get('/clinicians?availableNow=true&medium=VIDEO')
        .set(auth(mother))
        .expect(200);
      expect(listed.body.map((c: { id: string }) => c.id)).toContain(clinicianId);
    });

    it('books, pays, accepts and gives a call link that serves the call page (FR-CONS-09)', async () => {
      id = await bookAndPay({ medium: 'VIDEO', timing: 'ASAP', reason: 'Twitching' });
      const req = await h.http().get(`/consultations/${id}`).set(auth(doctor)).expect(200);
      expect(new Date(req.body.acceptDeadline).getTime() - Date.now()).toBeLessThanOrEqual(
        15 * 60_000,
      );
      await h.http().post(`/consultations/${id}/call`).set(auth(mother)).expect(409); // not accepted yet
      await h.http().post(`/consultations/${id}/accept`).set(auth(doctor)).expect(200);

      const link = await h.http().post(`/consultations/${id}/call`).set(auth(mother)).expect(200);
      expect(link.body.room).toBe(`nw-${id}`);
      const page = await h.http().get(new URL(link.body.joinUrl).pathname).expect(200);
      expect(page.headers['content-type']).toMatch(/text\/html/);
      expect(page.headers['content-security-policy']).toContain('wss://livekit.test.neowell.local');
      expect(page.text).toContain('livekit-client');
      expect(page.text).toContain('"video":true');
      await h.http().get('/calls/forged.token').expect(404);
    });

    it('starts, completes, refers, prescribes and gets reviewed (FR-CONS-11..13)', async () => {
      await h.http().post(`/consultations/${id}/start`).set(auth(doctor)).expect(200);
      const ref = await h
        .http()
        .post(`/consultations/${id}/referral`)
        .set(auth(doctor))
        .send({
          facilityName: 'Regional Hospital Bamenda',
          urgency: 'SAME_DAY',
          reason: 'Observation of possible seizures',
        })
        .expect(201);
      expect(ref.body.code).toMatch(/^NW-[A-Z2-9]{5}$/);
      await h
        .http()
        .post(`/consultations/${id}/referral`)
        .set(auth(doctor))
        .send({ facilityName: 'x', urgency: 'ROUTINE', reason: 'y' })
        .expect(409);

      const chart = await h
        .http()
        .post(`/consultations/${id}/drug-chart`)
        .set(auth(doctor))
        .send({
          items: [
            {
              drugName: 'Paracetamol syrup',
              dose: '1.5 ml',
              route: 'oral',
              timesOfDay: ['08:00', '20:00'],
              durationDays: 3,
            },
          ],
        })
        .expect(201);
      expect(chart.body.items).toHaveLength(1);

      const done = await h
        .http()
        .post(`/consultations/${id}/complete`)
        .set(auth(doctor))
        .send({ clinicianNotes: 'Seen on video', diagnosisSummary: 'Refer for observation' })
        .expect(200);
      expect(done.body).toMatchObject({ status: 'COMPLETED', chatOpen: true, canJoinCall: false });

      await h
        .http()
        .post(`/consultations/${id}/review`)
        .set(auth(mother))
        .send({ rating: 5, comment: 'Very kind' })
        .expect(201);
      await h
        .http()
        .post(`/consultations/${id}/review`)
        .set(auth(mother))
        .send({ rating: 1 })
        .expect(409);
      const profile = await h
        .http()
        .get(`/clinicians/${clinicianId}`)
        .set(auth(mother))
        .expect(200);
      expect(profile.body).toMatchObject({ ratingAvg: 5, ratingCount: 1 });

      const seen = await h.http().get(`/consultations/${id}`).set(auth(mother)).expect(200);
      expect(seen.body.referral).toMatchObject({
        urgency: 'SAME_DAY',
        facilityName: 'Regional Hospital Bamenda',
      });
    });

    it('shows the medicines to the caregiver and logs doses (FR-DRUG)', async () => {
      const charts = await h
        .http()
        .get(`/babies/${babyId}/drug-charts?active=true`)
        .set(auth(mother))
        .expect(200);
      expect(charts.body[0]).toMatchObject({ prescriber: 'Dr Amina N.', active: true });
      const item = charts.body[0].items[0];
      const at = new Date();
      at.setUTCHours(7, 0, 0, 0);
      await h
        .http()
        .post(`/drug-chart-items/${item.id}/doses`)
        .set(auth(mother))
        .send({ scheduledFor: at.toISOString(), status: 'GIVEN' })
        .expect(201);
      await h
        .http()
        .post(`/drug-chart-items/${item.id}/doses`)
        .set(auth(mother))
        .send({ scheduledFor: at.toISOString(), status: 'SKIPPED' })
        .expect(201);
      const chart = await h
        .http()
        .get(`/drug-charts/${charts.body[0].id}`)
        .set(auth(doctor))
        .expect(200);
      expect(chart.body.items[0].doseLogs).toEqual([
        expect.objectContaining({ status: 'SKIPPED' }),
      ]);
    });
  });

  describe('declines, expiry, webhooks and jobs', () => {
    it('refunds a declined request', async () => {
      const id = await bookAndPay({ medium: 'CHAT', timing: 'ASAP' });
      await h
        .http()
        .post(`/consultations/${id}/decline`)
        .set(auth(doctor))
        .send({ reason: 'Out of scope' })
        .expect(200);
      await h.jobs.drain();
      const c = await h.http().get(`/consultations/${id}`).set(auth(mother)).expect(200);
      expect(c.body).toMatchObject({ status: 'DECLINED', paymentStatus: 'REFUNDED' });
    });

    it('expires unanswered requests with a refund (J2)', async () => {
      const id = await bookAndPay({ medium: 'AUDIO', timing: 'ASAP' });
      await h.prisma.consultation.update({
        where: { id },
        data: { acceptDeadline: new Date(Date.now() - 1000) },
      });
      const result = await h.app.get(ConsultationsService).expireDue();
      expect(result.expired).toBeGreaterThanOrEqual(1);
      await h.jobs.drain();
      const c = await h.http().get(`/consultations/${id}`).set(auth(mother)).expect(200);
      expect(c.body).toMatchObject({ status: 'EXPIRED', paymentStatus: 'REFUNDED' });
    });

    it('applies signed payment webhooks once and ignores forged ones (W1)', async () => {
      const booked = await h
        .http()
        .post('/consultations')
        .set(auth(mother))
        .send({ babyId, clinicianId, medium: 'CHAT', timing: 'ASAP' })
        .expect(201);
      const payment = await h.prisma.payment.create({
        data: {
          consultationId: booked.body.id,
          provider: 'MTN_MOMO',
          payerPhone: '+237670000002',
          amountXaf: 2000,
          externalRef: `AGG-${Date.now()}`,
        },
      });
      await h.prisma.consultation.update({
        where: { id: booked.body.id },
        data: { paymentStatus: 'PENDING' },
      });
      const event = JSON.stringify({ reference: payment.externalRef, status: 'SUCCESSFUL' });

      await h
        .http()
        .post('/webhooks/payments/mtn')
        .set('Content-Type', 'application/json')
        .set('x-neowell-signature', 'bad')
        .send(event)
        .expect(200);
      expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'PENDING',
      );

      for (let i = 0; i < 2; i++) {
        await h
          .http()
          .post('/webhooks/payments/mtn')
          .set('Content-Type', 'application/json')
          .set('x-neowell-signature', h.sign(event))
          .send(event)
          .expect(200);
      }
      const c = await h
        .http()
        .get(`/consultations/${booked.body.id}`)
        .set(auth(mother))
        .expect(200);
      expect(c.body).toMatchObject({ status: 'REQUESTED', paymentStatus: 'PAID' });
      const events = await h.prisma.webhookEvent.findMany({
        where: {
          source: 'payments:MTN',
          payload: { path: ['reference'], equals: payment.externalRef! },
        },
      });
      expect(events.filter((e) => e.signatureValid)).toHaveLength(1);
      expect(events.filter((e) => !e.signatureValid).length).toBeGreaterThanOrEqual(1);
    });

    it('cancels unpaid bookings after 30 minutes (J2)', async () => {
      const booked = await h
        .http()
        .post('/consultations')
        .set(auth(mother))
        .send({ babyId, clinicianId, medium: 'CHAT', timing: 'ASAP' })
        .expect(201);
      await h.prisma.consultation.update({
        where: { id: booked.body.id },
        data: { createdAt: new Date(Date.now() - 31 * 60_000) },
      });
      await h.app.get(ConsultationsService).expireDue();
      expect(
        (await h.prisma.consultation.findUniqueOrThrow({ where: { id: booked.body.id } })).status,
      ).toBe('CANCELLED');
    });

    it('reminds caregivers when a recheck is due, with push to registered devices (J1, FR-NOT)', async () => {
      const older = (
        await h
          .http()
          .post('/babies')
          .set(auth(mother))
          .send(babyBody({ dateOfBirth: daysAgo(150), givenName: 'Bih' }))
          .expect(201)
      ).body.id;
      const r = await h
        .http()
        .post(`/babies/${older}/observations`)
        .set(auth(mother))
        .send({ temperatureC: 38.5 })
        .expect(201);
      expect(r.body.recheck).toBeTruthy();
      await h
        .http()
        .post('/me/devices')
        .set(auth(mother))
        .send({ expoPushToken: 'ExponentPushToken[test-device-1]', platform: 'android' })
        .expect(201);
      await h.prisma.recheck.update({
        where: { id: r.body.recheck.id },
        data: { dueAt: new Date(Date.now() - 1000) },
      });
      expect(await h.app.get(SchedulerService).remindRechecks()).toBe(1);
      await h.jobs.drain();
      const inbox = await h.http().get('/me/notifications').set(auth(mother)).expect(200);
      const n = inbox.body.items.find((x: { type: string }) => x.type === 'RECHECK_DUE');
      expect(n).toMatchObject({
        title: 'Re-check the temperature',
        body: 'It is time to re-check Bih’s temperature.',
      });
      expect(
        (await h.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).pushedAt,
      ).toBeTruthy();
      expect(inbox.body.unreadCount).toBeGreaterThan(0);
      await h
        .http()
        .post('/me/notifications/read')
        .set(auth(mother))
        .send({ all: true })
        .expect(204);
      expect((await h.http().get('/me/notifications').set(auth(mother))).body.unreadCount).toBe(0);
    });

    it('creates weekly payouts, shows earnings and lets admins mark them paid (J7)', async () => {
      const created = await h.app.get(AdminService).createWeeklyPayouts();
      expect(created.length).toBeGreaterThanOrEqual(1);
      const earnings = await h.http().get('/clinicians/me/earnings').set(auth(doctor)).expect(200);
      expect(earnings.body.payouts[0]).toMatchObject({ amountXaf: 5100, status: 'PENDING' }); // 6000 video − 15%
      const payouts = await h
        .http()
        .get('/admin/payouts?status=PENDING')
        .set(auth(admin))
        .expect(200);
      const mine = payouts.body.find((p: { clinicianId: string }) => p.clinicianId === clinicianId);
      expect(mine.clinician.payoutPhone).toBe('+237670009999');
      await h
        .http()
        .post(`/admin/payouts/${mine.id}/mark-paid`)
        .set(auth(admin))
        .send({ reference: 'MOMO-123' })
        .expect(201);
      const after = await h.http().get('/clinicians/me/earnings').set(auth(doctor)).expect(200);
      expect(after.body.paidXaf).toBe(5100);
    });

    it('reports platform statistics to admins only', async () => {
      await h.http().get('/admin/stats').set(auth(mother)).expect(403);
      const stats = await h.http().get('/admin/stats').set(auth(admin)).expect(200);
      expect(stats.body.revenueXaf.commission).toBeGreaterThan(0);
      expect(stats.body.consultations.COMPLETED).toBeGreaterThanOrEqual(1);
    });

    it('hides consultations from unrelated users', async () => {
      const stranger = await caregiver(h, 'Stranger');
      const anyId = (await h.prisma.consultation.findFirstOrThrow({ where: { clinicianId } })).id;
      await h.http().get(`/consultations/${anyId}`).set(auth(stranger)).expect(404);
      await h.http().get(`/consultations/${anyId}/messages`).set(auth(stranger)).expect(404);
    });
  });
});
