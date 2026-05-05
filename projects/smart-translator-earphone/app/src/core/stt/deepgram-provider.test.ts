/**
 * Story 2.1 — Deepgram cloud STT adapter (tests).
 */

import { DeepgramProvider } from './deepgram-provider';
import type { SttEvent } from './stt-types';
import { FakeWebSocketFactory, makeChunk } from './test-fakes';

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe('Story 2.1 — DeepgramProvider', () => {
  test('builds the Deepgram URL with the expected query string', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 'test-token',
      webSocketFactory: factory.build,
    });
    const startPromise = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    await startPromise;

    const url = new URL(factory.last().url);
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('api.deepgram.com');
    expect(url.pathname).toBe('/v1/listen');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('channels')).toBe('1');
    expect(url.searchParams.get('language')).toBe('en-US');
    expect(url.searchParams.get('interim_results')).toBe('true');
    expect(url.searchParams.get('model')).toBe('nova-2');
    expect(factory.last().authToken).toBe('test-token');
  });

  test('emits partial then final on Results messages', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const events: SttEvent[] = [];
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    session.on((ev) => events.push(ev));

    factory.last().simulateMessage(
      JSON.stringify({
        type: 'Results',
        is_final: false,
        channel: { alternatives: [{ transcript: 'hello', confidence: 0.6 }] },
      }),
    );
    factory.last().simulateMessage(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        channel: { alternatives: [{ transcript: 'hello world', confidence: 0.92 }] },
      }),
    );

    expect(events).toEqual([
      { type: 'partial', transcript: 'hello', confidence: 0.6, lang: 'en-US' },
      { type: 'final', transcript: 'hello world', confidence: 0.92, lang: 'en-US' },
    ]);
  });

  test('drops empty-transcript Results events', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const events: SttEvent[] = [];
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    session.on((ev) => events.push(ev));
    factory.last().simulateMessage(
      JSON.stringify({
        type: 'Results',
        is_final: false,
        channel: { alternatives: [{ transcript: '', confidence: 0 }] },
      }),
    );
    expect(events).toHaveLength(0);
  });

  test('send() forwards int16 little-endian PCM bytes over the socket', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;

    const chunk = makeChunk({ samples: 320, fill: 0x1234 });
    session.send(chunk);
    expect(factory.last().sentBinary).toHaveLength(1);
    const buf = factory.last().sentBinary[0]!;
    expect(buf.byteLength).toBe(320 * 2);
    const view = new DataView(buf);
    // little-endian int16 of 0x1234 → byte 0 = 0x34, byte 1 = 0x12
    expect(view.getUint8(0)).toBe(0x34);
    expect(view.getUint8(1)).toBe(0x12);
  });

  test('send() after end() throws', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    const endP = session.end();
    expect(() => session.send(makeChunk({}))).toThrow(/after end/);
    factory.last().simulateClose();
    await endP;
  });

  test('end() sends Deepgram CloseStream and resolves on socket close', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    const endP = session.end();
    expect(factory.last().sentText).toEqual([JSON.stringify({ type: 'CloseStream' })]);
    factory.last().simulateClose();
    await expect(endP).resolves.toBeUndefined();
  });

  test('language-detected event fires when Deepgram surfaces detected_language', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const events: SttEvent[] = [];
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    session.on((ev) => events.push(ev));
    factory.last().simulateMessage(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        channel: {
          alternatives: [{ transcript: 'hola', confidence: 0.85 }],
          detected_language: 'es-ES',
          language_confidence: 0.91,
        },
      }),
    );
    expect(events[0]).toEqual({
      type: 'language-detected',
      lang: 'es-ES',
      confidence: 0.91,
    });
    expect(events[1]).toEqual({
      type: 'final',
      transcript: 'hola',
      confidence: 0.85,
      lang: 'en-US',
    });
  });

  test('autoLanguageDetect emits an unsupported-language warning (V-05)', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const events: SttEvent[] = [];
    const startP = provider.start({ lang: 'en-US', autoLanguageDetect: true });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    session.on((ev) => events.push(ev));
    expect(events[0]?.type).toBe('error');
    if (events[0]?.type === 'error') {
      expect(events[0].code).toBe('unsupported-language');
    }
  });

  test('Deepgram Error message maps to the SttErrorCode taxonomy', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const events: SttEvent[] = [];
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    session.on((ev) => events.push(ev));
    factory.last().simulateMessage(
      JSON.stringify({ type: 'Error', err_code: 'INVALID_AUTH', message: 'bad token' }),
    );
    expect(events[0]).toEqual({ type: 'error', code: 'auth', message: 'bad token' });
  });

  test('socket close emits closed event', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const events: SttEvent[] = [];
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    session.on((ev) => events.push(ev));
    factory.last().simulateClose(1000, 'ok');
    expect(events.some((e) => e.type === 'closed')).toBe(true);
  });

  test('AbortSignal cancels the session and emits cancelled error then closed', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const ctrl = new AbortController();
    const events: SttEvent[] = [];
    const startP = provider.start({ lang: 'en-US', signal: ctrl.signal });
    await flushMicrotasks();
    factory.last().simulateOpen();
    const session = await startP;
    session.on((ev) => events.push(ev));
    ctrl.abort();
    await flushMicrotasks();
    expect(events[0]).toMatchObject({ type: 'error', code: 'cancelled' });
    expect(events.some((e) => e.type === 'closed')).toBe(true);
  });

  test('rejects start() if the socket closes before opening', async () => {
    const factory = new FakeWebSocketFactory();
    const provider = new DeepgramProvider({
      apiToken: 't',
      webSocketFactory: factory.build,
    });
    const startP = provider.start({ lang: 'en-US' });
    await flushMicrotasks();
    factory.last().simulateClose(4011, 'auth-failed');
    await expect(startP).rejects.toThrow(/4011/);
  });

  test('constructor rejects an empty apiToken', () => {
    expect(
      () =>
        new DeepgramProvider({
          apiToken: '',
          webSocketFactory: new FakeWebSocketFactory().build,
        }),
    ).toThrow(/apiToken/);
  });
});
