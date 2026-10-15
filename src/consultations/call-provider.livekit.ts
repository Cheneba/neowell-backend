import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { CallEvent, CallProvider } from './call-provider';

export class LiveKitCallProvider extends CallProvider {
  readonly enabled = true;
  private readonly receiver: WebhookReceiver;

  constructor(
    readonly serverUrl: string,
    private readonly key: string,
    private readonly secret: string,
  ) {
    super();
    this.receiver = new WebhookReceiver(key, secret);
  }

  async createJoinToken(p: { identity: string; name: string; room: string; ttlSeconds: number }) {
    const at = new AccessToken(this.key, this.secret, {
      identity: p.identity,
      name: p.name,
      ttl: p.ttlSeconds,
    });
    at.addGrant({
      roomJoin: true,
      room: p.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    return at.toJwt();
  }

  async parseWebhook(rawBody: string, authHeader?: string): Promise<CallEvent> {
    const e = await this.receiver.receive(rawBody, authHeader);
    return {
      id: e.id,
      type:
        e.event === 'participant_joined'
          ? 'participant_joined'
          : e.event === 'room_finished'
            ? 'room_finished'
            : 'other',
      room: e.room?.name,
      participantIdentity: e.participant?.identity,
    };
  }
}
