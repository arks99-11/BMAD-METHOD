/**
 * Story 9.4 — Group session view-model.
 *
 * Wraps a `GroupClient` and renders the live transcript of the group
 * session. The host pushes its own `TurnPair`s into `setHostTurns`;
 * listeners receive turns from the relay. Both sides see a
 * synchronised view of the host's transcript.
 *
 * Listener counts and presence (joined / left) are tracked for the
 * host's Group panel; listeners ignore them.
 */

import type { TurnPair } from '../session/session-types';
import type {
  GroupClient,
  GroupMessage,
  GroupRole,
  GroupSessionMeta,
} from './group-types';

export interface GroupViewState {
  meta?: GroupSessionMeta;
  role: GroupRole;
  turns: TurnPair[];
  listenerIds: string[];
  /** True after the relay confirms the host has left. */
  hostLeft: boolean;
  /** Last error surfaced from the relay. */
  error?: string;
}

export type GroupViewListener = (state: GroupViewState) => void;

export interface GroupViewModelOptions {
  client: GroupClient;
  role: GroupRole;
}

export class GroupViewModel {
  private readonly client: GroupClient;
  private readonly role: GroupRole;
  private meta: GroupSessionMeta | undefined;
  private turns: TurnPair[] = [];
  private listeners = new Set<string>();
  private subs = new Set<GroupViewListener>();
  private hostLeft = false;
  private error: string | undefined;
  private detach: (() => void) | null = null;

  constructor(opts: GroupViewModelOptions) {
    this.client = opts.client;
    this.role = opts.role;
  }

  on(listener: GroupViewListener): () => void {
    this.subs.add(listener);
    return () => {
      this.subs.delete(listener);
    };
  }

  /** Subscribe to relay messages. Call after open/join. */
  attach(): void {
    if (this.detach !== null) return;
    this.detach = this.client.on((m) => this.onMessage(m));
  }

  /** Remove the relay subscription (does not close the WS). */
  release(): void {
    if (this.detach !== null) {
      this.detach();
      this.detach = null;
    }
  }

  /**
   * Host pushes its current turn list. The view-model diffs against
   * the previous state and broadcasts only the changed turns over
   * the relay so listeners always see the same ordering as the host.
   */
  setHostTurns(turns: readonly TurnPair[]): void {
    if (this.role !== 'host') return;
    const prev = new Map(this.turns.map((t) => [t.id, t]));
    const next = new Map(turns.map((t) => [t.id, t]));
    for (const turn of turns) {
      const before = prev.get(turn.id);
      if (before === undefined || !sameTurn(before, turn)) {
        this.client.send({ type: 'turn', turn });
      }
    }
    for (const id of prev.keys()) {
      if (!next.has(id)) {
        this.client.send({ type: 'turn-removed', id });
      }
    }
    this.turns = turns.map((t) => ({ ...t }));
    this.emit();
  }

  state(): GroupViewState {
    const s: GroupViewState = {
      role: this.role,
      turns: [...this.turns],
      listenerIds: [...this.listeners],
      hostLeft: this.hostLeft,
    };
    if (this.meta !== undefined) s.meta = { ...this.meta };
    if (this.error !== undefined) s.error = this.error;
    return s;
  }

  private onMessage(message: GroupMessage): void {
    switch (message.type) {
      case 'meta':
        this.meta = message.meta;
        break;
      case 'turn':
        this.upsertTurn(message.turn);
        break;
      case 'turn-removed':
        this.turns = this.turns.filter((t) => t.id !== message.id);
        break;
      case 'host-left':
        this.hostLeft = true;
        break;
      case 'listener-joined':
        this.listeners.add(message.deviceId);
        break;
      case 'listener-left':
        this.listeners.delete(message.deviceId);
        break;
    }
    this.emit();
  }

  private upsertTurn(turn: TurnPair): void {
    const idx = this.turns.findIndex((t) => t.id === turn.id);
    if (idx === -1) {
      this.turns = [...this.turns, { ...turn }];
    } else {
      const next = [...this.turns];
      next[idx] = { ...turn };
      this.turns = next;
    }
  }

  private emit(): void {
    const snap = this.state();
    for (const l of this.subs) l(snap);
  }
}

function sameTurn(a: TurnPair, b: TurnPair): boolean {
  return (
    a.source.text === b.source.text &&
    a.source.isFinal === b.source.isFinal &&
    a.target.text === b.target.text &&
    a.target.isFinal === b.target.isFinal
  );
}
