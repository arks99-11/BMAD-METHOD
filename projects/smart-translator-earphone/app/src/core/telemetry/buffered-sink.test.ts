/**
 * Story 10.1 — BufferedTelemetrySink tests.
 */

import { BufferedTelemetrySink, type TelemetryUploader } from './buffered-sink';
import type { TelemetryEvent } from './telemetry-types';

class FakeUploader implements TelemetryUploader {
  readonly batches: TelemetryEvent[][] = [];
  shouldFail = false;
  /** When set, upload() awaits this promise before resolving. */
  gate: Promise<void> | null = null;

  async upload(batch: readonly TelemetryEvent[]): Promise<void> {
    this.batches.push([...batch]);
    if (this.gate !== null) await this.gate;
    if (this.shouldFail) throw new Error('upload-fail');
  }
}

function event(name: TelemetryEvent['name'], n = 0): TelemetryEvent {
  return { name, ts: n, tags: {} };
}

describe('BufferedTelemetrySink', () => {
  it('flushes when batch size is reached', () => {
    const uploader = new FakeUploader();
    const sink = new BufferedTelemetrySink({ uploader, batchSize: 2 });
    sink.capture(event('session.start', 1));
    expect(uploader.batches).toHaveLength(0);
    sink.capture(event('session.end', 2));
    expect(uploader.batches).toHaveLength(1);
    expect(uploader.batches[0]).toHaveLength(2);
  });

  it('flush() is a no-op when buffer is empty', async () => {
    const uploader = new FakeUploader();
    const sink = new BufferedTelemetrySink({ uploader });
    await sink.flush();
    expect(uploader.batches).toHaveLength(0);
  });

  it('flush() drains the buffer', async () => {
    const uploader = new FakeUploader();
    const sink = new BufferedTelemetrySink({ uploader, batchSize: 100 });
    sink.capture(event('session.start'));
    sink.capture(event('session.end'));
    await sink.flush();
    expect(uploader.batches).toHaveLength(1);
    expect(uploader.batches[0]).toHaveLength(2);
    expect(sink.size()).toBe(0);
  });

  it('reset() drops buffered events', () => {
    const uploader = new FakeUploader();
    const sink = new BufferedTelemetrySink({ uploader, batchSize: 100 });
    sink.capture(event('session.start'));
    sink.reset();
    expect(sink.size()).toBe(0);
  });

  it('failed uploads return events to the buffer', async () => {
    const uploader = new FakeUploader();
    uploader.shouldFail = true;
    const sink = new BufferedTelemetrySink({ uploader, batchSize: 100 });
    sink.capture(event('session.start'));
    await sink.flush();
    expect(sink.size()).toBe(1);
  });

  it('coalesces concurrent flush() calls', async () => {
    const uploader = new FakeUploader();
    let release: () => void = () => undefined;
    uploader.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sink = new BufferedTelemetrySink({ uploader, batchSize: 100 });
    sink.capture(event('session.start'));
    sink.capture(event('session.end'));
    const a = sink.flush();
    const b = sink.flush();
    expect(a).toBe(b);
    release();
    await a;
    expect(uploader.batches).toHaveLength(1);
  });

  it('start()/stop() schedules a periodic flush', () => {
    const uploader = new FakeUploader();
    let cb: (() => void) | undefined;
    let stopped = false;
    const sink = new BufferedTelemetrySink({
      uploader,
      flushIntervalMs: 10,
      setIntervalFn: (fn: () => void): unknown => {
        cb = fn;
        return 1;
      },
      clearIntervalFn: (_h: unknown): void => {
        stopped = true;
      },
    });
    sink.start();
    sink.capture(event('session.start'));
    expect(cb).toBeDefined();
    cb?.();
    expect(uploader.batches).toHaveLength(1);
    sink.stop();
    expect(stopped).toBe(true);
  });
});
