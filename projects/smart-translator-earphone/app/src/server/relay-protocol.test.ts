/**
 * Epic 11 / Story 9.3 — relay-protocol tests.
 */

import type { GroupMessage } from '../core/group/group-types';
import { GroupRelayChannel, RelayError, type Participant } from './relay-protocol';

class FakeParticipant implements Participant {
  readonly received: GroupMessage[] = [];

  constructor(
    public readonly id: string,
    public readonly role: 'host' | 'listener',
  ) {}

  send(message: GroupMessage): void {
    this.received.push(message);
  }
}

const META: GroupMessage = {
  type: 'meta',
  meta: {
    id: 'sess-1',
    token: 'ABCDEF',
    hostLang: 'EN',
    targetLangs: ['ES'],
    startedAt: 0,
  },
};

describe('GroupRelayChannel', () => {
  it('starts empty', () => {
    const ch = new GroupRelayChannel();
    expect(ch.isEmpty()).toBe(true);
    expect(ch.hasHost()).toBe(false);
  });

  it('attach(host) sets hasHost and emits no listener events when alone', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    ch.attach(host);
    expect(ch.hasHost()).toBe(true);
    expect(host.received).toHaveLength(0);
  });

  it('rejects a second host', () => {
    const ch = new GroupRelayChannel();
    ch.attach(new FakeParticipant('h1', 'host'));
    expect(() => ch.attach(new FakeParticipant('h2', 'host'))).toThrow(RelayError);
  });

  it('replays cached meta to late-joining listeners', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    ch.attach(host);
    ch.receive('h', META);
    const listener = new FakeParticipant('l1', 'listener');
    ch.attach(listener);
    expect(listener.received).toContainEqual(META);
  });

  it('forwards turn messages from host to all listeners', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    const l1 = new FakeParticipant('l1', 'listener');
    const l2 = new FakeParticipant('l2', 'listener');
    ch.attach(host);
    ch.attach(l1);
    ch.attach(l2);
    const turn: GroupMessage = {
      type: 'turn',
      turn: {
        id: 't1',
        source: { text: 'hi', lang: 'EN', isFinal: true },
        target: { text: 'hola', lang: 'ES', isFinal: true },
        startedAt: 0,
      },
    };
    ch.receive('h', turn);
    expect(l1.received.at(-1)).toEqual(turn);
    expect(l2.received.at(-1)).toEqual(turn);
    expect(host.received.find((m) => m.type === 'turn')).toBeUndefined();
  });

  it('emits listener-joined to host on each new listener', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    ch.attach(host);
    ch.attach(new FakeParticipant('l1', 'listener'));
    ch.attach(new FakeParticipant('l2', 'listener'));
    const joined = host.received.filter((m) => m.type === 'listener-joined');
    expect(joined).toHaveLength(2);
  });

  it('sends listener-joined for existing listeners when host attaches second', () => {
    const ch = new GroupRelayChannel();
    ch.attach(new FakeParticipant('l1', 'listener'));
    ch.attach(new FakeParticipant('l2', 'listener'));
    const host = new FakeParticipant('h', 'host');
    ch.attach(host);
    const joined = host.received.filter((m) => m.type === 'listener-joined');
    expect(joined).toHaveLength(2);
  });

  it('detach(listener) emits listener-left to host', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    ch.attach(host);
    ch.attach(new FakeParticipant('l1', 'listener'));
    host.received.length = 0;
    ch.detach('l1');
    expect(host.received.find((m) => m.type === 'listener-left')).toBeDefined();
  });

  it('detach(host) emits host-left to all listeners', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    const l1 = new FakeParticipant('l1', 'listener');
    const l2 = new FakeParticipant('l2', 'listener');
    ch.attach(host);
    ch.attach(l1);
    ch.attach(l2);
    ch.detach('h');
    expect(l1.received.find((m) => m.type === 'host-left')).toBeDefined();
    expect(l2.received.find((m) => m.type === 'host-left')).toBeDefined();
    expect(ch.hasHost()).toBe(false);
  });

  it('listener writes are rejected', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    const listener = new FakeParticipant('l', 'listener');
    ch.attach(host);
    ch.attach(listener);
    const turn: GroupMessage = {
      type: 'turn',
      turn: {
        id: 't',
        source: { text: '', lang: 'EN', isFinal: true },
        target: { text: '', lang: 'ES', isFinal: true },
        startedAt: 0,
      },
    };
    expect(() => ch.receive('l', turn)).toThrow(RelayError);
  });

  it('rejects host-emitted server messages', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    ch.attach(host);
    expect(() => ch.receive('h', { type: 'host-left' })).toThrow(RelayError);
  });

  it('close() drains all listeners with host-left', () => {
    const ch = new GroupRelayChannel();
    const host = new FakeParticipant('h', 'host');
    const l1 = new FakeParticipant('l1', 'listener');
    ch.attach(host);
    ch.attach(l1);
    ch.close();
    expect(l1.received.find((m) => m.type === 'host-left')).toBeDefined();
    expect(ch.isEmpty()).toBe(true);
  });

  it('listenerCount tracks attached listeners', () => {
    const ch = new GroupRelayChannel();
    ch.attach(new FakeParticipant('l1', 'listener'));
    ch.attach(new FakeParticipant('l2', 'listener'));
    expect(ch.listenerCount()).toBe(2);
    ch.detach('l1');
    expect(ch.listenerCount()).toBe(1);
  });
});
