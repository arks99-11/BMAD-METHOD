/**
 * Story 9.4 — GroupViewModel tests.
 */

import type { TurnPair } from '../session/session-types';
import type {
  GroupClient,
  GroupMessage,
  GroupSessionMeta,
} from './group-types';
import { GroupViewModel } from './group-viewmodel';

class FakeGroupClient implements GroupClient {
  readonly sent: GroupMessage[] = [];
  private listeners = new Set<(m: GroupMessage) => void>();

  async hostOpen(_meta: GroupSessionMeta): Promise<void> {
    // no-op for tests
  }

  async join(_token: string, _deviceId: string): Promise<GroupSessionMeta> {
    return META;
  }

  send(message: GroupMessage): void {
    this.sent.push(message);
  }

  on(listener: (m: GroupMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    // no-op
  }

  push(message: GroupMessage): void {
    for (const l of this.listeners) l(message);
  }
}

const META: GroupSessionMeta = {
  id: 'sess-1',
  token: 'ABCDEF',
  hostLang: 'EN',
  targetLangs: ['ES', 'DE'],
  startedAt: 0,
  title: 'Live tour',
};

function makeTurn(id: string, src: string, tgt: string, finalised = true): TurnPair {
  return {
    id,
    source: { text: src, lang: 'EN', isFinal: finalised },
    target: { text: tgt, lang: 'ES', isFinal: finalised },
    startedAt: 0,
    ...(finalised ? { completedAt: 1 } : {}),
  };
}

describe('GroupViewModel (host)', () => {
  it('broadcasts new turns to the relay', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'host' });
    vm.attach();
    vm.setHostTurns([makeTurn('a', 'hi', 'hola')]);
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toMatchObject({ type: 'turn' });
  });

  it('broadcasts only changed turns on subsequent setHostTurns', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'host' });
    vm.attach();
    vm.setHostTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    client.sent.length = 0;
    vm.setHostTurns([
      makeTurn('a', 'hi', 'hola'), // unchanged
      makeTurn('b', 'goodbye', 'adios'), // changed source
    ]);
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toMatchObject({ type: 'turn' });
    if (client.sent[0]?.type === 'turn') {
      expect(client.sent[0].turn.id).toBe('b');
    }
  });

  it('emits turn-removed when a turn drops from the host list', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'host' });
    vm.attach();
    vm.setHostTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    client.sent.length = 0;
    vm.setHostTurns([makeTurn('a', 'hi', 'hola')]);
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toEqual({ type: 'turn-removed', id: 'b' });
  });

  it('tracks listener presence from the relay', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'host' });
    vm.attach();
    client.push({ type: 'listener-joined', deviceId: 'dev-1' });
    client.push({ type: 'listener-joined', deviceId: 'dev-2' });
    client.push({ type: 'listener-left', deviceId: 'dev-1' });
    expect(vm.state().listenerIds).toEqual(['dev-2']);
  });
});

describe('GroupViewModel (listener)', () => {
  it('hydrates meta from a relay message', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    vm.attach();
    client.push({ type: 'meta', meta: META });
    expect(vm.state().meta?.token).toBe('ABCDEF');
  });

  it('receives turns from the relay', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    vm.attach();
    client.push({ type: 'turn', turn: makeTurn('a', 'hi', 'hola') });
    expect(vm.state().turns).toHaveLength(1);
  });

  it('updates an existing turn on a second message with the same id', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    vm.attach();
    client.push({ type: 'turn', turn: makeTurn('a', 'hel', 'ho', false) });
    client.push({ type: 'turn', turn: makeTurn('a', 'hello', 'hola') });
    expect(vm.state().turns).toHaveLength(1);
    expect(vm.state().turns[0]!.source.text).toBe('hello');
    expect(vm.state().turns[0]!.source.isFinal).toBe(true);
  });

  it('removes turns on turn-removed', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    vm.attach();
    client.push({ type: 'turn', turn: makeTurn('a', 'hi', 'hola') });
    client.push({ type: 'turn-removed', id: 'a' });
    expect(vm.state().turns).toHaveLength(0);
  });

  it('flags hostLeft on host-left', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    vm.attach();
    client.push({ type: 'host-left' });
    expect(vm.state().hostLeft).toBe(true);
  });

  it('does not broadcast turns when role=listener', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    vm.attach();
    vm.setHostTurns([makeTurn('a', 'hi', 'hola')]);
    expect(client.sent).toHaveLength(0);
  });

  it('release() detaches the relay subscription', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    vm.attach();
    vm.release();
    client.push({ type: 'turn', turn: makeTurn('a', 'hi', 'hola') });
    expect(vm.state().turns).toHaveLength(0);
  });

  it('emits state to subscribers', () => {
    const client = new FakeGroupClient();
    const vm = new GroupViewModel({ client, role: 'listener' });
    const captured: number[] = [];
    vm.on((s) => captured.push(s.turns.length));
    vm.attach();
    client.push({ type: 'turn', turn: makeTurn('a', 'hi', 'hola') });
    client.push({ type: 'turn', turn: makeTurn('b', 'bye', 'adios') });
    expect(captured).toEqual([1, 2]);
  });
});
