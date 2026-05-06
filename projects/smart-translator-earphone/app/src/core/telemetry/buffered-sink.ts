/**
 * Story 10.1 — Buffered telemetry sink.
 *
 * Buffers events and flushes them in batches to a `TelemetryUploader`
 * (the platform-specific HTTP transport, e.g. PostHog). Triggers:
 *
 *   - hit `batchSize` events (default 50)
 *   - `flush()` called explicitly
 *   - `flushIntervalMs` elapsed (default 30 s)
 *
 * Failed uploads back the events back into the buffer so they retry
 * on the next trigger.
 *
 * The sink runs a single in-flight upload at a time; concurrent
 * `flush()` calls are coalesced.
 */

import type { TelemetryEvent, TelemetrySink } from './telemetry-types';

export interface TelemetryUploader {
  upload(batch: readonly TelemetryEvent[]): Promise<void>;
}

export interface BufferedTelemetrySinkOptions {
  uploader: TelemetryUploader;
  batchSize?: number;
  flushIntervalMs?: number;
  /** Test seam for the periodic flush timer. */
  setIntervalFn?: (cb: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export class BufferedTelemetrySink implements TelemetrySink {
  private readonly uploader: TelemetryUploader;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly setIntervalFn: (cb: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private buffer: TelemetryEvent[] = [];
  private inFlight: Promise<void> | null = null;
  private intervalHandle: unknown = null;

  constructor(opts: BufferedTelemetrySinkOptions) {
    this.uploader = opts.uploader;
    this.batchSize = opts.batchSize ?? 50;
    this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
    this.setIntervalFn =
      opts.setIntervalFn ??
      ((cb: () => void, ms: number): unknown => globalThis.setInterval(cb, ms));
    this.clearIntervalFn =
      opts.clearIntervalFn ??
      ((handle: unknown): void => {
        globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
      });
  }

  start(): void {
    if (this.intervalHandle !== null) return;
    this.intervalHandle = this.setIntervalFn(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  capture(event: TelemetryEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  flush(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    if (this.buffer.length === 0) return Promise.resolve();

    const batch = this.buffer;
    this.buffer = [];
    const settled = this.uploader
      .upload(batch)
      .catch(() => {
        // Re-queue at the front so order is preserved. Failed
        // uploads are not propagated to callers; callers learn
        // about them via the buffer growing back.
        this.buffer = [...batch, ...this.buffer];
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = settled;
    return settled;
  }

  reset(): void {
    this.buffer = [];
  }

  size(): number {
    return this.buffer.length;
  }
}
