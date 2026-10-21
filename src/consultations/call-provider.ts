/** Room event from the call provider's webhook, in provider-neutral form. */
export interface CallEvent {
  id: string;
  type: 'participant_joined' | 'room_finished' | 'other';
  room?: string;
  participantIdentity?: string;
}

/**
 * Audio/video call provider port. A driver mints join credentials and verifies room-event
 * webhooks. LiveKit is the only driver today (see call-provider.livekit.ts).
 */
export abstract class CallProvider {
  abstract readonly enabled: boolean;
  /** Provider server URL handed to the call page. */
  abstract readonly serverUrl: string;
  abstract createJoinToken(p: {
    identity: string;
    name: string;
    room: string;
    ttlSeconds: number;
  }): Promise<string>;
  /** Verifies and parses a webhook. Throws if the signature is invalid. */
  abstract parseWebhook(rawBody: string, authHeader?: string): Promise<CallEvent>;
}

/** Used when no provider is configured. */
export class DisabledCallProvider extends CallProvider {
  readonly enabled = false;
  readonly serverUrl = '';
  async createJoinToken(): Promise<string> {
    throw new Error('Calls are not configured');
  }
  async parseWebhook(): Promise<CallEvent> {
    throw new Error('Calls are not configured');
  }
}
