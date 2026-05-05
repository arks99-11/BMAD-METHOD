/**
 * Story 4.5 — Playback orchestrator tests.
 */

import { wrapAsTtsStream } from './base-tts-provider';
import { PlaybackOrchestrator, type TtsPlaybackEvent } from './playback-orchestrator';
import {
  TtsError,
  type TtsAudioFormat,
  type TtsProvider,
  type TtsRequest,
  type TtsResult,
  type TtsStream,
} from './tts-types';

class ControllableTtsProvider implements TtsProvider {
  readonly engine: TtsProvider['engine'] = 'mock';
  readonly calls: Array<{
    req: TtsRequest;
    resolve: (r: TtsResult) => void;
    reject: (e: TtsError) => void;
    aborted: boolean;
  }> = [];
  /** Per-engine override for testing native pass-through. */
  setEngine(engine: TtsProvider['engine']): void {
    (this as { engine: TtsProvider['engine'] }).engine = engine;
  }

  synthesize(req: TtsRequest): Promise<TtsResult> {
    return this.synthesizeStream(req).done;
  }

  synthesizeStream(req: TtsRequest): TtsStream {
    const entry: {
      req: TtsRequest;
      resolve: (r: TtsResult) => void;
      reject: (e: TtsError) => void;
      aborted: boolean;
    } = {
      req,
      resolve: () => undefined,
      reject: () => undefined,
      aborted: false,
    };
    const promise = new Promise<TtsResult>((res, rej) => {
      entry.resolve = res;
      entry.reject = rej;
    });
    if (req.signal !== undefined) {
      req.signal.addEventListener('abort', () => {
        entry.aborted = true;
        entry.reject(new TtsError('cancelled', 'mock', 'aborted'));
      });
    }
    this.calls.push(entry);
    return wrapAsTtsStream('mock', promise);
  }

  finish(idx: number, audio: Uint8Array, format: TtsAudioFormat = 'pcm-s16le-24k'): void {
    this.calls[idx]?.resolve({
      audio,
      format,
      engine: this.engine,
      voice: this.calls[idx]?.req.voice ?? '',
      durationMs: 1,
    });
  }
}

function buildReq(text: string): {
  text: string;
  voice: string;
  language: string;
} {
  return { text, voice: 'v', language: 'EN' };
}

describe('Story 4.5 — PlaybackOrchestrator', () => {
  test('submit issues a synthesize call and feeds audio chunks to the sink', async () => {
    const provider = new ControllableTtsProvider();
    const sinkChunks: number[] = [];
    const events: TtsPlaybackEvent[] = [];
    const orch = new PlaybackOrchestrator({
      provider,
      onAudioChunk: (audio) => {
        for (const b of audio) sinkChunks.push(b);
      },
    });
    orch.on((ev) => events.push(ev));

    orch.submit(buildReq('Hello'));
    expect(provider.calls.length).toBe(1);
    provider.finish(0, new Uint8Array([1, 2, 3]));
    await new Promise((r) => setTimeout(r, 5));

    expect(sinkChunks).toEqual([1, 2, 3]);
    expect(events.map((e) => e.type)).toEqual(['started', 'chunk', 'completed']);
  });

  test('replaces an in-flight playback (cancel-and-replace)', async () => {
    const provider = new ControllableTtsProvider();
    const events: TtsPlaybackEvent[] = [];
    const orch = new PlaybackOrchestrator({ provider });
    orch.on((ev) => events.push(ev));

    orch.submit(buildReq('First'));
    expect(provider.calls.length).toBe(1);
    orch.submit(buildReq('Second'));
    expect(provider.calls.length).toBe(2);
    expect(provider.calls[0]!.aborted).toBe(true);
    expect(events.some((e) => e.type === 'cancelled')).toBe(true);

    provider.finish(1, new Uint8Array([10]));
    await new Promise((r) => setTimeout(r, 5));
    const completed = events.filter((e) => e.type === 'completed');
    expect(completed.length).toBe(1);
  });

  test('reset cancels without emitting cancelled', () => {
    const provider = new ControllableTtsProvider();
    const events: TtsPlaybackEvent[] = [];
    const orch = new PlaybackOrchestrator({ provider });
    orch.on((ev) => events.push(ev));

    orch.submit(buildReq('Hello'));
    orch.reset();
    expect(provider.calls[0]!.aborted).toBe(true);
    expect(events.some((e) => e.type === 'cancelled')).toBe(false);
  });

  test('empty/whitespace text is dropped', () => {
    const provider = new ControllableTtsProvider();
    const orch = new PlaybackOrchestrator({ provider });
    orch.submit(buildReq(''));
    orch.submit(buildReq('   '));
    expect(provider.calls.length).toBe(0);
  });

  test('native engine: chunks are NOT forwarded to the sink', async () => {
    const provider = new ControllableTtsProvider();
    provider.setEngine('native');
    const sinkChunks: number[] = [];
    const events: TtsPlaybackEvent[] = [];
    const orch = new PlaybackOrchestrator({
      provider,
      onAudioChunk: (audio) => {
        for (const b of audio) sinkChunks.push(b);
      },
    });
    orch.on((ev) => events.push(ev));

    orch.submit(buildReq('Hello'));
    provider.finish(0, new Uint8Array([1, 2, 3]));
    await new Promise((r) => setTimeout(r, 5));

    expect(sinkChunks).toEqual([]);
    // Started + completed still emitted; chunk is not (because the
    // wrapAsTtsStream emits a chunk event but the orchestrator
    // suppresses the sink callback for native).
    expect(events.some((e) => e.type === 'completed')).toBe(true);
  });

  test('listener unsubscribe stops further events', async () => {
    const provider = new ControllableTtsProvider();
    const events: TtsPlaybackEvent[] = [];
    const orch = new PlaybackOrchestrator({ provider });
    const unsub = orch.on((e) => events.push(e));
    orch.submit(buildReq('Hello'));
    unsub();
    provider.finish(0, new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 5));
    expect(events.length).toBe(0);
  });

  test('non-cancellation errors propagate to listeners', async () => {
    const provider = new ControllableTtsProvider();
    const events: TtsPlaybackEvent[] = [];
    const orch = new PlaybackOrchestrator({ provider });
    orch.on((e) => events.push(e));
    orch.submit(buildReq('Hello'));
    provider.calls[0]!.reject(new TtsError('engine', 'mock', 'boom'));
    await new Promise((r) => setTimeout(r, 5));
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  test('cancelled errors from provider are suppressed', async () => {
    const provider = new ControllableTtsProvider();
    const events: TtsPlaybackEvent[] = [];
    const orch = new PlaybackOrchestrator({ provider });
    orch.on((e) => events.push(e));
    orch.submit(buildReq('Hello'));
    provider.calls[0]!.reject(new TtsError('cancelled', 'mock', 'aborted'));
    await new Promise((r) => setTimeout(r, 5));
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
