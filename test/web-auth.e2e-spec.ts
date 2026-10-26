import { auth, createHarness, Harness } from './harness';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

describe('NeoWell API — web dashboard auth & verification (e2e)', () => {
  let h: Harness;
  let adminToken: string;
  // The test database persists between runs, so emails carry a per-run tag.
  const run = Date.now();
  const adminEmail = `admin-${run}@neowell.test`;

  /** The OTP service enforces a 60 s resend cooldown per phone; clear it to reuse a number. */
  const requestOtp = async (path: string, phone: string) => {
    await h.prisma.otpCode.deleteMany({ where: { phone } });
    await h.http().post(path).send({ phone }).expect(202);
  };

  const registerWeb = async (phone: string, email: string) => {
    await requestOtp('/auth/web/otp/request', phone);
    return h
      .http()
      .post('/auth/web/register')
      .send({
        phone,
        code: h.sms.last.get(phone),
        email,
        password: 'a-long-password',
        firstName: 'Ada',
        lastName: 'Ngu',
        locale: 'fr',
      });
  };

  beforeAll(async () => {
    h = await createHarness();
    const phone = h.newPhone();
    const token = await h.login(phone);
    const me = await h.prisma.user.update({
      where: { phone },
      data: { role: 'ADMIN', email: adminEmail },
    });
    expect(me.role).toBe('ADMIN');
    // Sign in again so the token carries the new role, and set a password through the API.
    await requestOtp('/auth/otp/request', phone);
    adminToken = (
      await h
        .http()
        .post('/auth/otp/verify')
        .send({ phone, code: h.sms.last.get(phone) })
        .expect(200)
    ).body.accessToken;
    void token;
    await h
      .http()
      .put('/auth/web/credentials')
      .set(auth(adminToken))
      .send({ newPassword: 'admin-password-1' })
      .expect(204);
  });
  afterAll(() => h.close());

  it('lets an admin sign in by email and password, and rejects a wrong one', async () => {
    await h
      .http()
      .post('/auth/web/login')
      .send({ email: adminEmail, password: 'nope-nope-nope' })
      .expect(401);
    const res = await h
      .http()
      .post('/auth/web/login')
      .send({ email: adminEmail.toUpperCase(), password: 'admin-password-1' })
      .expect(200);
    await h.http().get('/admin/stats').set(auth(res.body.accessToken)).expect(200);
  });

  it('keeps caregivers out of the web dashboard auth', async () => {
    const phone = h.newPhone();
    await h.login(phone);
    await requestOtp('/auth/web/otp/request', phone);
    await h
      .http()
      .post('/auth/web/otp/verify')
      .send({ phone, code: h.sms.last.get(phone) })
      .expect(401);
  });

  it('refuses a duplicate email or phone when registering', async () => {
    const phone = h.newPhone();
    await registerWeb(phone, `dup-${run}@doctors.test`).then((r) => expect(r.status).toBe(201));
    expect((await registerWeb(h.newPhone(), `dup-${run}@doctors.test`)).status).toBe(409);
    expect((await registerWeb(phone, `other-${run}@doctors.test`)).status).toBe(409);
  });

  it('does not let the app register clinicians, and blocks unverified ones', async () => {
    const fresh = h.newPhone();
    await requestOtp('/auth/otp/request', fresh);
    const denied = await h
      .http()
      .post('/auth/otp/verify')
      .send({ phone: fresh, code: h.sms.last.get(fresh), role: 'CLINICIAN' })
      .expect(403);
    expect(denied.body.code).toBe('CLINICIAN_REGISTER_ON_WEB');

    const phone = h.newPhone();
    expect((await registerWeb(phone, `gate-${run}@doctors.test`)).status).toBe(201);
    await requestOtp('/auth/otp/request', phone);
    const blocked = await h
      .http()
      .post('/auth/otp/verify')
      .send({ phone, code: h.sms.last.get(phone) })
      .expect(403);
    expect(blocked.body.code).toBe('CLINICIAN_NOT_VERIFIED');
    // The web still lets them in, to finish onboarding.
    await requestOtp('/auth/web/otp/request', phone);
    await h
      .http()
      .post('/auth/web/otp/verify')
      .send({ phone, code: h.sms.last.get(phone) })
      .expect(200);
  });

  it('runs the whole verification flow with email notices to the clinician and the admin', async () => {
    const phone = h.newPhone();
    const email = `flow-${run}@doctors.test`;
    const token = (await registerWeb(phone, email)).body.accessToken as string;
    await h
      .http()
      .post('/clinicians/me')
      .set(auth(token))
      .send({
        firstName: 'Ada',
        lastName: 'Ngu',
        licenseNumber: `LIC-${Date.now()}`,
        specialties: ['PAEDIATRICS'],
        feeChatXaf: 2000,
        feeAudioXaf: 4000,
        feeVideoXaf: 6000,
      })
      .expect(201);
    await h.http().post('/clinicians/me/submit').set(auth(token)).expect(400);

    for (const type of ['MEDICAL_LICENSE', 'MEDICAL_DEGREE', 'EMPLOYMENT_PROOF']) {
      await h
        .http()
        .post('/clinicians/me/documents')
        .set(auth(token))
        .field('type', type)
        .attach('file', PDF, { filename: `${type}.pdf`, contentType: 'application/pdf' })
        .expect(201);
    }
    await h
      .http()
      .post('/clinicians/me/photo')
      .set(auth(token))
      .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' })
      .expect(201);
    // Replacing an upload is fine, and nothing is queued until the doctor submits.
    await h
      .http()
      .post('/clinicians/me/photo')
      .set(auth(token))
      .attach('file', PNG, { filename: 'me2.png', contentType: 'image/png' })
      .expect(201);
    await h.jobs.drain();
    expect(h.emails.sent.filter((m) => m.to === adminEmail && m.text.includes('Ada'))).toHaveLength(
      0,
    );
    expect((await h.http().get('/clinicians/me').set(auth(token))).body.verificationStatus).toBe(
      'PENDING_DOCUMENTS',
    );
    await h.http().post('/clinicians/me/submit').set(auth(token)).expect(201);
    await h.jobs.drain();
    const me = await h.http().get('/clinicians/me').set(auth(token)).expect(200);
    expect(me.body.verificationStatus).toBe('PENDING_REVIEW');
    // Queued once, however many times it was uploaded.
    expect(h.emails.sent.filter((m) => m.to === email)).toHaveLength(1);
    expect(h.emails.sent.filter((m) => m.to === adminEmail && m.text.includes('Ada'))).toHaveLength(
      1,
    );

    await h
      .http()
      .post(`/admin/clinicians/${me.body.id}/review`)
      .set(auth(adminToken))
      .send({ decision: 'REJECTED', note: 'Licence photo is blurry' })
      .expect(201);
    await h.jobs.drain();
    expect(h.emails.sent.some((m) => m.to === email && m.text.includes('blurry'))).toBe(true);

    await h.http().post('/clinicians/me/submit').set(auth(token)).expect(201);
    await h
      .http()
      .post(`/admin/clinicians/${me.body.id}/review`)
      .set(auth(adminToken))
      .send({ decision: 'VERIFIED' })
      .expect(201);
    await h.jobs.drain();

    // Now the app lets them in.
    await requestOtp('/auth/otp/request', phone);
    await h
      .http()
      .post('/auth/otp/verify')
      .send({ phone, code: h.sms.last.get(phone) })
      .expect(200);

    const system = await h.http().get('/admin/system').set(auth(adminToken)).expect(200);
    expect(system.body.database).toBe('up');
    expect(system.body.jobs.FAILED).toBeGreaterThanOrEqual(0);
  });

  it('resets a forgotten password with the phone code', async () => {
    const phone = h.newPhone();
    await registerWeb(phone, `forgot-${run}@doctors.test`);
    await requestOtp('/auth/web/otp/request', phone);
    await h
      .http()
      .post('/auth/web/password/reset')
      .send({ phone, code: h.sms.last.get(phone), newPassword: 'brand-new-password' })
      .expect(204);
    await h
      .http()
      .post('/auth/web/login')
      .send({ email: `forgot-${run}@doctors.test`, password: 'a-long-password' })
      .expect(401);
    await h
      .http()
      .post('/auth/web/login')
      .send({ email: `forgot-${run}@doctors.test`, password: 'brand-new-password' })
      .expect(200);
  });
});
