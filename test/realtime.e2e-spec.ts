import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { Realtime } from '../src/realtime/realtime.service';
import { auth, caregiver, createHarness, Harness } from './harness';

const next = (ws: WebSocket) =>
  new Promise<{ event: string; data: unknown }>((resolve) =>
    ws.once('message', (m) => resolve(JSON.parse(m.toString()))),
  );
const closed = (ws: WebSocket) => new Promise<number>((resolve) => ws.once('close', resolve));
const opened = (ws: WebSocket) => new Promise<void>((resolve) => ws.once('open', () => resolve()));

describe('Realtime websocket (e2e)', () => {
  let h: Harness;
  let url: string;

  beforeAll(async () => {
    h = await createHarness();
    await h.app.listen(0, '127.0.0.1');
    url = `ws://127.0.0.1:${((h.app.getHttpServer() as unknown as import('node:http').Server).address() as AddressInfo).port}/ws`;
  });
  afterAll(() => h.close());

  it('authenticates with a JWT and receives pushed events', async () => {
    const token = await caregiver(h);
    const me = await h.http().get('/me').set(auth(token)).expect(200);
    const ws = new WebSocket(url);
    await opened(ws);
    const ready = next(ws);
    ws.send(JSON.stringify({ event: 'auth', data: { token } }));
    expect((await ready).event).toBe('ready');

    const msg = next(ws);
    expect(h.app.get(Realtime).emitToUser(me.body.id, 'notification', { title: 'Hi' })).toBe(1);
    expect(await msg).toEqual({ event: 'notification', data: { title: 'Hi' } });
    ws.close();
  });

  it('closes connections that present a bad token', async () => {
    const ws = new WebSocket(url);
    await opened(ws);
    const c = closed(ws);
    ws.send(JSON.stringify({ event: 'auth', data: { token: 'nope' } }));
    expect(await c).toBe(4401);
  });
});
