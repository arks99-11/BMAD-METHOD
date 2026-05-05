/**
 * Tests for shared TTS helpers.
 */

import {
  abortablePromise,
  concatChunks,
  readStreamWithCallback,
  wrapAsTtsStream,
} from './base-tts-provider';
import { TtsError, type TtsResult, type TtsStreamEvent } from './tts-types';

describe('concatChunks', () => {
  test('concatenates multiple Uint8Arrays in order', () => {
    const out = concatChunks([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5, 6]),
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('returns an empty array for an empty input', () => {
    expect(concatChunks([]).byteLength).toBe(0);
  });
});

describe('wrapAsTtsStream', () => {
  function makeResult(): TtsResult {
    return {
      audio: new Uint8Array([1, 2, 3]),
      format: 'pcm-s16le-24k',
      engine: 'mock',
      voice: 'v',
      durationMs: 1,
    };
  }

  test('emits chunk + final on success', async () => {
    const stream = wrapAsTtsStream('mock', Promise.resolve(makeResult()));
    const events: TtsStreamEvent[] = [];
    stream.on((e) => events.push(e));
    await stream.done;
    expect(events.map((e) => e.type)).toEqual(['chunk', 'final']);
  });

  test('emits error event when promise rejects', async () => {
    const stream = wrapAsTtsStream(
      'mock',
      Promise.reject(new TtsError('engine', 'mock', 'fail')),
    );
    const events: TtsStreamEvent[] = [];
    stream.on((e) => events.push(e));
    await expect(stream.done).rejects.toMatchObject({ code: 'engine' });
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  test('wraps non-TtsError rejections as unknown', async () => {
    const stream = wrapAsTtsStream(
      'mock',
      Promise.reject(new Error('plain')),
    );
    const events: TtsStreamEvent[] = [];
    stream.on((e) => events.push(e));
    await expect(stream.done).rejects.toMatchObject({
      code: 'unknown',
      engine: 'mock',
    });
  });
});

describe('abortablePromise (TTS)', () => {
  test('rejects with cancelled when aborted', async () => {
    const ctrl = new AbortController();
    const p = abortablePromise(ctrl.signal, 'mock');
    setTimeout(() => ctrl.abort(), 1);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('rejects immediately when already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortablePromise(ctrl.signal, 'mock')).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});

describe('readStreamWithCallback', () => {
  test('emits each chunk and returns the concatenated buffer', async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const seen: Uint8Array[] = [];
    const result = await readStreamWithCallback(stream, (c) => seen.push(c), undefined);
    expect(seen.length).toBe(2);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  test('throws aborted when signal already aborted', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      readStreamWithCallback(stream, () => undefined, ctrl.signal),
    ).rejects.toThrow(/aborted/);
  });
});
