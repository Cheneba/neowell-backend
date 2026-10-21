import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import type { JwtPayload } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Realtime } from './realtime.service';

const AUTH_TIMEOUT_MS = 10_000;
const PING_MS = 30_000;
const CLOSE_UNAUTHORIZED = 4401;

type Client = WebSocket & { userId?: string; alive?: boolean };

/**
 * WebSocket endpoint at /ws. The first message must authenticate:
 *   → {"event":"auth","data":{"token":"<access token>"}}   ← {"event":"ready"}
 * (a header or query token would end up in proxy logs, and React Native cannot set headers).
 * Afterwards the server pushes `{event, data}` frames such as `notification`.
 */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway
  extends Realtime
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger('Realtime');
  private readonly byUser = new Map<string, Set<Client>>();
  private readonly pings = setInterval(() => this.ping(), PING_MS);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {
    super();
    this.pings.unref();
  }

  handleConnection(client: Client) {
    client.alive = true;
    client.on('pong', () => (client.alive = true));
    const timer = setTimeout(() => {
      if (!client.userId) client.close(CLOSE_UNAUTHORIZED, 'auth timeout');
    }, AUTH_TIMEOUT_MS);
    timer.unref();
    client.once('close', () => clearTimeout(timer));
  }

  handleDisconnect(client: Client) {
    if (!client.userId) return;
    const set = this.byUser.get(client.userId);
    set?.delete(client);
    if (set && !set.size) this.byUser.delete(client.userId);
  }

  @SubscribeMessage('auth')
  async auth(@ConnectedSocket() client: Client, @MessageBody() body: { token?: string }) {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(String(body?.token ?? ''));
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true },
      });
      if (!user?.isActive) throw new Error('inactive');
      client.userId = user.id;
      let set = this.byUser.get(user.id);
      if (!set) this.byUser.set(user.id, (set = new Set()));
      set.add(client);
      return { event: 'ready', data: {} };
    } catch {
      client.close(CLOSE_UNAUTHORIZED, 'unauthorized');
      return undefined;
    }
  }

  emitToUser(userId: string, event: string, data: unknown): number {
    const frame = JSON.stringify({ event, data });
    let sent = 0;
    for (const c of this.byUser.get(userId) ?? []) {
      if (c.readyState === c.OPEN) {
        c.send(frame);
        sent++;
      }
    }
    return sent;
  }

  /** Drops connections that stopped answering pings (phone went offline without closing). */
  private ping() {
    for (const set of this.byUser.values()) {
      for (const c of set) {
        if (!c.alive) {
          c.terminate();
          continue;
        }
        c.alive = false;
        c.ping();
      }
    }
  }

  onModuleDestroy() {
    clearInterval(this.pings);
    this.logger.log('Realtime gateway closed');
  }
}
