/**
 * Story 5.4 — Engine transparency sheet data.
 *
 * Tracks rolling latency for STT, MT, and TTS so the UI can display
 * "current latency" without scanning the full turn log every render.
 *
 * Implementation: a bounded ring buffer of the last `n` durations per
 * stage (default 5). The mean is exposed as the "current" latency;
 * the UI may render p50/p95 in a future iteration but the v1 sheet
 * just shows a single number per stage.
 */

export interface LatencyTracker {
  push(stage: 'stt' | 'mt' | 'tts', durationMs: number): void;
  mean(stage: 'stt' | 'mt' | 'tts'): number | undefined;
}

export class RollingLatencyTracker implements LatencyTracker {
  private readonly capacity: number;
  private readonly buffers: Record<'stt' | 'mt' | 'tts', number[]> = {
    stt: [],
    mt: [],
    tts: [],
  };

  constructor(capacity: number = 5) {
    if (capacity <= 0) {
      throw new Error('RollingLatencyTracker: capacity must be positive.');
    }
    this.capacity = capacity;
  }

  push(stage: 'stt' | 'mt' | 'tts', durationMs: number): void {
    const buf = this.buffers[stage];
    buf.push(durationMs);
    if (buf.length > this.capacity) {
      buf.shift();
    }
  }

  mean(stage: 'stt' | 'mt' | 'tts'): number | undefined {
    const buf = this.buffers[stage];
    if (buf.length === 0) return undefined;
    const sum = buf.reduce((a, b) => a + b, 0);
    return Math.round(sum / buf.length);
  }
}
