/**
 * Story 9.1 / 9.2 — Group session contracts.
 *
 * A group session is hosted by one device and joined by 1..N
 * listener devices. The host streams `TurnPair` updates over a
 * Cloudflare Durable Object relay (Epic 11). The join handshake
 * uses a 6-character invite token shown on screen and embedded in
 * a QR code; the listener device hits the relay's `/join` endpoint
 * with the token and receives a websocket session.
 *
 * This module ships the JS-side contracts; the RN shell binds the
 * WS client to the platform websocket impl.
 */

import type { LangCode } from '../audio/audio-session-types';
import type { TurnPair } from '../session/session-types';

/**
 * 6-character base32-style invite token. Avoids ambiguous chars
 * (0/O, 1/I, etc.) and stays case-insensitive on the wire.
 */
export type InviteToken = string;

export interface GroupSessionMeta {
  /** Stable session id used for the relay channel. */
  id: string;
  /** Human-readable invite token (6 chars). */
  token: InviteToken;
  /** Origin language (the host speaks). */
  hostLang: LangCode;
  /** Listener-selectable target languages allowed by the host. */
  targetLangs: readonly LangCode[];
  /** Optional title shown on the join screen. */
  title?: string;
  /** ms epoch when the session opened. */
  startedAt: number;
}

export type GroupRole = 'host' | 'listener';

/** Wire format messages, host -> relay -> listeners (and vice versa). */
export type GroupMessage =
  | { type: 'meta'; meta: GroupSessionMeta }
  | { type: 'turn'; turn: TurnPair }
  | { type: 'turn-removed'; id: string }
  | { type: 'host-left' }
  | { type: 'listener-joined'; deviceId: string }
  | { type: 'listener-left'; deviceId: string };

export interface GroupClient {
  /** Open a connection as the host, broadcasting a fresh meta payload. */
  hostOpen(meta: GroupSessionMeta): Promise<void>;
  /** Join as a listener using the invite token. */
  join(token: InviteToken, deviceId: string): Promise<GroupSessionMeta>;
  /** Send a wire message. Host-only for `turn` and `turn-removed`. */
  send(message: GroupMessage): void;
  /** Subscribe to messages from the relay. */
  on(listener: (message: GroupMessage) => void): () => void;
  /** Disconnect and release the channel. */
  close(): Promise<void>;
}
