/**
 * Realtime delivery port: pushes an event to every open connection of a user.
 * The WebSocket gateway is the only implementation today; a Redis/pub-sub backed one
 * would replace it to scale beyond a single server instance.
 */
export abstract class Realtime {
  /** Returns how many live connections received the event. */
  abstract emitToUser(userId: string, event: string, data: unknown): number;
}
