/**
 * Story 4.3a — Native TTS provider tests.
 */

import {
  NativeTtsProvider,
  type NativeTtsBridge,
  type NativeTtsBridgeHandle,
  type NativeTtsBridgeRequest,
  type NativeTtsBridgeVoice,
} from './native-tts-provider';
import type { TtsStreamEvent } from './tts-types';

class FakeBridge implements NativeTtsBridge {
  readonly speakCalls: NativeTtsBridgeRequest[] = [];
  voices: NativeTtsBridgeVoice[] = [];

  private resolveSpeak: (() => void) | null = null;
  private rejectSpeak: ((err: Error) => void) | null = null;

  speak(req: NativeTtsBridgeRequest): NativeTtsBridgeHandle {
    this.speakCalls.push(req);
    const done = new Promise<void>((res, rej) => {
      this.resolveSpeak = res;
      this.rejectSpeak = rej;
    });
    return {
      done,
      cancel: () => {
        this.rejectSpeak?.(new Error('cancelled'));
      },
    };
  }

  finish(): void {
    this.resolveSpeak?.();
  }

  fail(msg: string): void {
    this.rejectSpeak?.(new Error(msg));
  }

  async listVoices(): Promise<NativeTtsBridgeVoice[]> {
    return this.voices;
  }
}

describe('Story 4.3a — NativeTtsProvider', () => {
  test('forwards text/voice/language to the bridge', () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    void provider.synthesize({ text: 'Hello', voice: 'v', language: 'EN' });
    expect(bridge.speakCalls.length).toBe(1);
    expect(bridge.speakCalls[0]).toMatchObject({ text: 'Hello', voice: 'v', language: 'EN' });
  });

  test('forwards optional rate / pitch when provided', () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    void provider.synthesize({
      text: 'Hello',
      voice: 'v',
      language: 'EN',
      rate: 1.5,
      pitch: 2,
    });
    expect(bridge.speakCalls[0]).toEqual({
      text: 'Hello',
      voice: 'v',
      language: 'EN',
      rate: 1.5,
      pitch: 2,
    });
  });

  test('resolves with an empty audio buffer (native plays through speaker)', async () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    const promise = provider.synthesize({ text: 'Hello', voice: 'v', language: 'EN' });
    bridge.finish();
    const result = await promise;
    expect(result.audio.byteLength).toBe(0);
    expect(result.engine).toBe('native');
  });

  test('synthesizeStream emits final without chunks (native pass-through)', async () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    const events: TtsStreamEvent[] = [];
    const stream = provider.synthesizeStream({
      text: 'Hello',
      voice: 'v',
      language: 'EN',
    });
    stream.on((e) => events.push(e));
    bridge.finish();
    await stream.done;
    expect(events.map((e) => e.type)).toEqual(['final']);
  });

  test('AbortSignal cancels via bridge.cancel and surfaces cancelled', async () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5);
    await expect(
      provider.synthesize({
        text: 'Hello',
        voice: 'v',
        language: 'EN',
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('errors mentioning "voice" map to unsupported-voice', async () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    const promise = provider.synthesize({ text: 'Hi', voice: 'v', language: 'EN' });
    bridge.fail('voice not installed');
    await expect(promise).rejects.toMatchObject({ code: 'unsupported-voice' });
  });

  test('errors mentioning "language" map to unsupported-language', async () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    const promise = provider.synthesize({ text: 'Hi', voice: 'v', language: 'EN' });
    bridge.fail('language data missing');
    await expect(promise).rejects.toMatchObject({ code: 'unsupported-language' });
  });

  test('plain errors map to engine code', async () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    const promise = provider.synthesize({ text: 'Hi', voice: 'v', language: 'EN' });
    bridge.fail('weird thing');
    await expect(promise).rejects.toMatchObject({ code: 'engine' });
  });

  test('listVoices returns the bridge voices', async () => {
    const bridge = new FakeBridge();
    bridge.voices = [
      { id: 'v1', name: 'Alex', language: 'en-US', quality: 'enhanced' },
      { id: 'v2', name: 'Samantha', language: 'en-US' },
    ];
    const provider = new NativeTtsProvider(bridge);
    const list = await provider.listVoices();
    expect(list.length).toBe(2);
    expect(list[0]?.id).toBe('v1');
  });

  test('aborted-before-call still reports cancelled', async () => {
    const bridge = new FakeBridge();
    const provider = new NativeTtsProvider(bridge);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      provider.synthesize({
        text: 'Hello',
        voice: 'v',
        language: 'EN',
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
