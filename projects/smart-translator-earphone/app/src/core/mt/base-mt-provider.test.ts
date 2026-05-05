/**
 * Tests for the shared MT helpers (`wrapAsStream`, `abortablePromise`).
 */

import { abortablePromise, wrapAsStream } from './base-mt-provider';
import { MtError, type MtResult, type MtStreamEvent } from './mt-types';

describe('wrapAsStream', () => {
  function buildResult(): MtResult {
    return {
      text: 'translated',
      engine: 'mock',
      durationMs: 1,
    };
  }

  test('emits chunk then final on a successful promise', async () => {
    const events: MtStreamEvent[] = [];
    const stream = wrapAsStream('mock', Promise.resolve(buildResult()));
    stream.on((ev) => events.push(ev));
    await stream.done;
    expect(events.map((e) => e.type)).toEqual(['chunk', 'final']);
    expect(events[0]).toMatchObject({ type: 'chunk', text: 'translated' });
  });

  test('replays events to a late listener', async () => {
    const stream = wrapAsStream('mock', Promise.resolve(buildResult()));
    await stream.done; // resolve before attaching listener
    const events: MtStreamEvent[] = [];
    stream.on((ev) => events.push(ev));
    // Replay either the queued chunk+final or just the terminal final
    expect(events.map((e) => e.type)).toContain('final');
  });

  test('emits error event when the underlying promise rejects', async () => {
    const stream = wrapAsStream(
      'mock',
      Promise.reject(new MtError('engine', 'mock', 'boom')),
    );
    const events: MtStreamEvent[] = [];
    stream.on((ev) => events.push(ev));
    await expect(stream.done).rejects.toMatchObject({ code: 'engine' });
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('abortablePromise', () => {
  test('rejects with cancelled MtError when the signal aborts', async () => {
    const ctrl = new AbortController();
    const p = abortablePromise(ctrl.signal, 'mock');
    setTimeout(() => ctrl.abort(), 1);
    await expect(p).rejects.toMatchObject({ code: 'cancelled', engine: 'mock' });
  });

  test('rejects immediately if the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortablePromise(ctrl.signal, 'mock')).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  test('never resolves when no signal is provided', async () => {
    const p = abortablePromise(undefined, 'mock');
    const winner = await Promise.race([
      p.catch(() => 'rejected' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 20)),
    ]);
    expect(winner).toBe('timeout');
  });
});
