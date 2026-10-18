import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { CamPayGateway } from './campay.gateway';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<Env, true>;

describe('CamPayGateway', () => {
  const originalFetch = global.fetch;
  const calls: { url: string; init: RequestInit }[] = [];

  const stubFetch = (payload: unknown) =>
    ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    }) as unknown as typeof fetch;

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('collects with a permanent token and strips the + from the phone', async () => {
    global.fetch = stubFetch({ reference: 'REF-1', status: 'PENDING' });
    const gw = new CamPayGateway(
      config({ CAMPAY_BASE_URL: 'https://demo.campay.net/api/', CAMPAY_PERMANENT_TOKEN: 'perm' }),
    );

    const result = await gw.collect({
      paymentId: 'p1',
      amountXaf: 5000,
      payerPhone: '+237677000000',
      operator: 'MTN_MOMO',
      description: 'Test',
    });

    expect(result).toEqual({ externalRef: 'REF-1', status: 'PENDING', reason: undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://demo.campay.net/api/collect/');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Token perm');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      amount: '5000',
      currency: 'XAF',
      from: '237677000000',
      external_reference: 'p1',
    });
  });

  it('logs in with username/password when no permanent token is set', async () => {
    const responses = [{ token: 'fresh-token' }, { reference: 'REF-2', status: 'SUCCESSFUL' }];
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 }));
    }) as unknown as typeof fetch;

    const gw = new CamPayGateway(
      config({
        CAMPAY_BASE_URL: 'https://demo.campay.net/api',
        CAMPAY_APP_USERNAME: 'app',
        CAMPAY_APP_PASSWORD: 'secret',
      }),
    );
    const result = await gw.collect({
      paymentId: 'p2',
      amountXaf: 1000,
      payerPhone: '+237699000000',
      operator: 'ORANGE_MONEY',
      description: 'Test',
    });

    expect(calls.map((c) => c.url)).toEqual([
      'https://demo.campay.net/api/token/',
      'https://demo.campay.net/api/collect/',
    ]);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe(
      'Token fresh-token',
    );
    expect(result.status).toBe('SUCCESSFUL');
  });

  it('maps CamPay statuses onto the gateway vocabulary', async () => {
    const gw = new CamPayGateway(
      config({ CAMPAY_BASE_URL: 'https://demo.campay.net/api', CAMPAY_PERMANENT_TOKEN: 'perm' }),
    );
    for (const [campay, expected] of [
      ['SUCCESSFUL', 'SUCCESSFUL'],
      ['FAILED', 'FAILED'],
      ['CANCELLED', 'FAILED'],
      ['PENDING', 'PENDING'],
      ['SOMETHING_ELSE', 'PENDING'],
    ] as const) {
      global.fetch = stubFetch({ status: campay });
      const out = await gw.status({ externalRef: 'REF', payerPhone: '+237677000000' });
      expect(out.status).toBe(expected);
    }
  });
});
