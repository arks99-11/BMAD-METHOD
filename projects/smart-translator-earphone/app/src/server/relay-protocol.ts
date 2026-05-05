/**
 * Epic 11 / Story 9.3 — Group session relay protocol.
 *
 * Pure-TS state machine that an upstream Durable Object wraps with
 * websocket transport. Hosts and listeners join a `GroupRelayChannel`
 * keyed by session id; the channel:
 *
 *   - Broadcasts `meta` to every newly-joined participant.
 *   - Forwards `turn` / `turn-removed` messages from the host to
 *     all listeners.
 *   - Notifies the host about `listener-joined` / `listener-left`.
 *   - Emits `host-left` to every listener when the host disconnects.
 *
 * The channel does not own the websocket; instead it accepts a
 * `Participant` object with `send(message)` and an opaque `id`.
 * The Durable Object glues incoming WS frames to `receive()` and
 * each `send()` to a WS write.
 *
 * Rate-limiting / abuse handling lives upstream of this module.
 */

import type { GroupMessage, GroupRole } from '../core/group/group-types';

export interface Participant {
  /** Unique connection id; e.g. a v4 UUID per WS. */
  id: string;
  role: GroupRole;
  send(message: GroupMessage): void;
}

export class GroupRelayChannel {
  private host: Participant | undefined;
  private readonly listeners = new Map<string, Participant>();
  private meta: Extract<GroupMessage, { type: 'meta' }> | undefined;

  /** Returns true if the channel is empty (the DO can self-destruct). */
  isEmpty(): boolean {
    return this.host === undefined && this.listeners.size === 0;
  }

  /** True iff a host is connected. */
  hasHost(): boolean {
    return this.host !== undefined;
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  /** Register a participant. Called when the WS handshake completes. */
  attach(p: Participant): void {
    if (p.role === 'host') {
      if (this.host !== undefined) {
        // Reject second host. Caller closes the WS.
        throw new RelayError('host-conflict');
      }
      this.host = p;
      // Broadcast existing listeners' presence to the host so it
      // shows the right participant count.
      for (const id of this.listeners.keys()) {
        p.send({ type: 'listener-joined', deviceId: id });
      }
    } else {
      this.listeners.set(p.id, p);
      if (this.meta !== undefined) {
        p.send(this.meta);
      }
      this.host?.send({ type: 'listener-joined', deviceId: p.id });
    }
  }

  /** Remove a participant. Called on WS close. */
  detach(participantId: string): void {
    if (this.host?.id === participantId) {
      this.host = undefined;
      for (const l of this.listeners.values()) {
        l.send({ type: 'host-left' });
      }
      return;
    }
    if (this.listeners.delete(participantId)) {
      this.host?.send({ type: 'listener-left', deviceId: participantId });
    }
  }

  /**
   * Process an inbound message from a participant. The protocol
   * routing rules:
   *
   *   - Host -> meta: cached for late-joining listeners; forwarded
   *     to all listeners.
   *   - Host -> turn / turn-removed: forwarded to all listeners.
   *   - Listener -> *: rejected (listeners are read-only in v1).
   */
  receive(participantId: string, message: GroupMessage): void {
    const isHost = this.host?.id === participantId;
    if (!isHost) {
      throw new RelayError('listener-write-rejected');
    }
    switch (message.type) {
      case 'meta':
        this.meta = message;
        for (const l of this.listeners.values()) l.send(message);
        return;
      case 'turn':
      case 'turn-removed':
        for (const l of this.listeners.values()) l.send(message);
        return;
      case 'host-left':
      case 'listener-joined':
      case 'listener-left':
        // Server-emitted only.
        throw new RelayError('client-emitted-server-message');
    }
  }

  /** For the DO to drain on shutdown. */
  close(): void {
    if (this.host !== undefined) {
      for (const l of this.listeners.values()) {
        l.send({ type: 'host-left' });
      }
      this.host = undefined;
    }
    this.listeners.clear();
  }
}

export type RelayErrorCode =
  | 'host-conflict'
  | 'listener-write-rejected'
  | 'client-emitted-server-message';

export class RelayError extends Error {
  constructor(public readonly code: RelayErrorCode) {
    super(code);
    this.name = 'RelayError';
  }
}
