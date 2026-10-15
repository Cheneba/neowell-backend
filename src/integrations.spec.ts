import { generateKeyPairSync } from 'node:crypto';
import { CampayPaymentGateway } from './payments/campay.gateway';
import { SmtpEmailService } from './notifications/email.smtp';
import { FcmPushService } from './notifications/push.fcm';
import { TwilioSmsService } from './notifications/sms.twilio';
import { R2StorageService } from './storage/storage.r2';
import { OpenAiSpeechToText } from './voice/speech-to-text.openai';

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe('TwilioSmsService', () => {
  it('posts a form with basic auth', async () => {
    const f = jest.fn().mockResolvedValue(json(201, {}));
    await new TwilioSmsService({ accountSid: 'AC1', authToken: 't', from: '+1555' }, f).send(
      '+237600000000',
      'code 123',
    );
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/Accounts/AC1/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:t').toString('base64')}`);
    expect(init.body.get('To')).toBe('+237600000000');
    expect(init.body.get('From')).toBe('+1555');
  });
  it('prefers the messaging service and throws on errors', async () => {
    const f = jest.fn().mockResolvedValue(json(400, { code: 21211, message: 'bad number' }));
    const sms = new TwilioSmsService({ accountSid: 'A', authToken: 't', messagingServiceSid: 'MG1' }, f);
    await expect(sms.send('x', 'y')).rejects.toThrow('Twilio error 21211: bad number');
    expect(f.mock.calls[0][1].body.get('MessagingServiceSid')).toBe('MG1');
  });
});

describe('SmtpEmailService', () => {
  it('sends with the configured from address', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const mail = new SmtpEmailService(
      { host: 'h', port: 587, secure: false, from: 'NeoWell <a@b.c>' },
      { sendMail } as never,
    );
    await mail.send({ to: 'u@x.y', subject: 's', text: 't' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'NeoWell <a@b.c>', to: 'u@x.y', subject: 's' }),
    );
  });
});

describe('FcmPushService', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const sa = JSON.stringify({ project_id: 'p1', client_email: 'x@p1.iam', private_key: privateKey });
  const oauth = json(200, { access_token: 'at', expires_in: 3600 });

  it('exchanges a JWT then sends, stringifying data and caching the token', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(oauth)
      .mockResolvedValue(json(200, { name: 'projects/p1/messages/1' }));
    const fcm = new FcmPushService(Buffer.from(sa).toString('base64'), f);
    const msg = { to: 'tok', title: 'T', body: 'B', data: { n: 1 } };
    expect(await fcm.send(msg)).toEqual({ status: 'ok', id: 'projects/p1/messages/1' });
    await fcm.send(msg);
    expect(f).toHaveBeenCalledTimes(3); // one oauth, two sends
    expect(JSON.parse(f.mock.calls[1][1].body).message.data).toEqual({ n: '1' });
  });
  it('flags dead tokens and retries outages', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(oauth)
      .mockResolvedValueOnce(
        json(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }),
      )
      .mockResolvedValueOnce(json(503, { error: { message: 'down' } }));
    const fcm = new FcmPushService(sa, f);
    const dead = await fcm.send({ to: 't', title: 'a', body: 'b' });
    expect(dead).toMatchObject({ status: 'error', details: { error: 'DeviceNotRegistered' } });
    await expect(fcm.send({ to: 't', title: 'a', body: 'b' })).rejects.toThrow('FCM HTTP 503');
  });
});

describe('CampayPaymentGateway', () => {
  const cfg = { baseUrl: 'https://demo.campay.net/api', username: 'u', password: 'p' };
  it('collects with a stripped msisdn and a token header', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(json(200, { token: 'tk' }))
      .mockResolvedValueOnce(json(200, { reference: 'ref-1' }));
    const r = await new CampayPaymentGateway(cfg, f).collect({
      paymentId: 'pay-1',
      amountXaf: 5000,
      payerPhone: '+237670000000',
      operator: 'MTN_MOMO',
      description: 'Consult',
    });
    expect(r).toEqual({ externalRef: 'ref-1', status: 'PENDING' });
    const [, init] = f.mock.calls[1];
    expect(init.headers.Authorization).toBe('Token tk');
    expect(JSON.parse(init.body)).toMatchObject({
      amount: '5000',
      from: '237670000000',
      external_reference: 'pay-1',
    });
  });
  it('maps statuses and reuses the token', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(json(200, { token: 'tk' }))
      .mockResolvedValueOnce(json(200, { status: 'SUCCESSFUL' }))
      .mockResolvedValueOnce(json(200, { status: 'FAILED', reason: 'LOW_BALANCE' }))
      .mockResolvedValueOnce(json(200, { status: 'PENDING' }));
    const g = new CampayPaymentGateway(cfg, f);
    const p = { externalRef: 'r', payerPhone: '+237' };
    expect((await g.status(p)).status).toBe('SUCCESSFUL');
    expect(await g.status(p)).toEqual({ status: 'FAILED', reason: 'LOW_BALANCE' });
    expect((await g.status(p)).status).toBe('PENDING');
    expect(f).toHaveBeenCalledTimes(4);
  });
  it('refunds with a withdrawal and surfaces API errors', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(json(200, { token: 'tk' }))
      .mockResolvedValueOnce(json(200, { reference: 'w-1' }))
      .mockResolvedValueOnce(json(400, { message: 'insufficient funds' }));
    const g = new CampayPaymentGateway(cfg, f);
    const req = { originalRef: 'r', amountXaf: 100, payerPhone: '+237670000000' };
    expect(await g.refund(req)).toEqual({ externalRef: 'w-1', status: 'PENDING' });
    expect(f.mock.calls[1][0]).toContain('/withdraw/');
    await expect(g.refund(req)).rejects.toThrow('insufficient funds');
  });
});

describe('R2StorageService', () => {
  it('puts under prefix/uuid.ext, reads back and deletes', async () => {
    const send = jest.fn().mockImplementation(async (cmd: { constructor: { name: string } }) =>
      cmd.constructor.name === 'GetObjectCommand'
        ? { Body: { transformToByteArray: async () => new Uint8Array([1, 2]) } }
        : {},
    );
    const r2 = new R2StorageService(
      { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' },
      { send } as never,
    );
    const key = await r2.put('babies', 'Photo.JPG', Buffer.from('x'));
    expect(key).toMatch(/^babies\/[0-9a-f-]{36}\.jpg$/);
    expect([...(await r2.read(key))]).toEqual([1, 2]);
    await r2.delete([key]);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('OpenAiSpeechToText', () => {
  it('posts audio with an optional bearer key', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { text: ' hello ', language: 'en' }));
    const r = await new OpenAiSpeechToText('http://stt', 'm', 'key', f).transcribe(
      Buffer.from('a'),
      'audio/mp4',
      'n.m4a',
    );
    expect(r).toEqual({ text: 'hello', language: 'en' });
    expect(f.mock.calls[0][0]).toBe('http://stt/v1/audio/transcriptions');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer key');
  });
});
