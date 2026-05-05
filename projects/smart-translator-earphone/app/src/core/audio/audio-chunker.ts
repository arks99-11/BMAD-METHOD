/**
 * Story 1.2 — Audio frame buffer and chunker.
 *
 * Aggregates 20 ms PCM frames (FRAME_SAMPLES = 320 samples) into chunks of
 * configurable duration suitable for streaming STT. Supports:
 *
 *  - Fixed-duration chunking (`chunkMs`).
 *  - Utterance-aligned flushes (signaled by `markUtteranceBoundary`).
 *  - Maximum chunk-duration safety (`maxChunkMs`) to bound latency even when
 *    a speaker never pauses.
 *  - End-of-stream flush (final = true).
 */

import { AudioChunk, AudioFrame, FRAME_DURATION_MS, FRAME_SAMPLES } from './audio-types';

export interface ChunkerOptions {
  /** Target chunk size in milliseconds. Must be a multiple of FRAME_DURATION_MS. */
  chunkMs: number;
  /** Maximum allowed chunk size in milliseconds (forced flush). */
  maxChunkMs: number;
}

const DEFAULT_OPTIONS: ChunkerOptions = {
  chunkMs: 300,
  maxChunkMs: 1500,
};

export type ChunkListener = (chunk: AudioChunk) => void;

export class AudioChunker {
  private readonly framesPerChunk: number;
  private readonly framesMaxChunk: number;
  private readonly buffer: AudioFrame[] = [];
  private readonly listeners = new Set<ChunkListener>();

  constructor(options: Partial<ChunkerOptions> = {}) {
    const o = { ...DEFAULT_OPTIONS, ...options };
    if (o.chunkMs % FRAME_DURATION_MS !== 0) {
      throw new Error(`chunkMs (${o.chunkMs}) must be a multiple of ${FRAME_DURATION_MS}`);
    }
    if (o.maxChunkMs < o.chunkMs) {
      throw new Error(`maxChunkMs (${o.maxChunkMs}) must be >= chunkMs (${o.chunkMs})`);
    }
    this.framesPerChunk = o.chunkMs / FRAME_DURATION_MS;
    this.framesMaxChunk = o.maxChunkMs / FRAME_DURATION_MS;
  }

  /** Push a single frame; emits a chunk if the target size is reached. */
  push(frame: AudioFrame): void {
    this.buffer.push(frame);
    if (this.buffer.length >= this.framesPerChunk) {
      this.flushInternal({ utteranceBoundary: false, final: false });
    } else if (this.buffer.length >= this.framesMaxChunk) {
      // This branch is reachable only if framesPerChunk == framesMaxChunk; left
      // for defense in depth.
      this.flushInternal({ utteranceBoundary: false, final: false });
    }
  }

  /**
   * Indicate that the VAD just emitted an utterance boundary. The current
   * partial chunk (if any) is flushed with `utteranceBoundary = true`.
   */
  markUtteranceBoundary(): void {
    if (this.buffer.length === 0) return;
    this.flushInternal({ utteranceBoundary: true, final: false });
  }

  /**
   * Flush any remaining frames as a `final` chunk. After this, the chunker is
   * empty and can be reused for a new session.
   *
   * Pass `{ utteranceBoundary: true }` when the flush coincides with the end
   * of an in-progress utterance (e.g. the pipeline is stopping mid-utterance
   * and the VAD will emit `utterance-end` for the same frame). This lets a
   * downstream STT consumer treat the chunk as final-of-stream AND
   * final-of-utterance in a single event.
   */
  flushFinal(opts: { utteranceBoundary?: boolean } = {}): void {
    if (this.buffer.length === 0) return;
    this.flushInternal({ utteranceBoundary: opts.utteranceBoundary === true, final: true });
  }

  /** Subscribe to chunk events. Returns an unsubscribe function. */
  onChunk(listener: ChunkListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test helper: number of buffered (not-yet-flushed) frames. */
  get pendingFrameCount(): number {
    return this.buffer.length;
  }

  private flushInternal(opts: { utteranceBoundary: boolean; final: boolean }): void {
    if (this.buffer.length === 0) return;
    const frames = this.buffer.splice(0, this.buffer.length);
    const totalSamples = frames.length * FRAME_SAMPLES;
    const merged = new Int16Array(totalSamples);
    for (let i = 0; i < frames.length; i++) {
      merged.set(frames[i]!.samples, i * FRAME_SAMPLES);
    }
    const chunk: AudioChunk = {
      samples: merged,
      startSeq: frames[0]!.seq,
      endSeq: frames.at(-1)!.seq,
      startTimestampMs: frames[0]!.timestampMs,
      durationMs: frames.length * FRAME_DURATION_MS,
      final: opts.final,
      utteranceBoundary: opts.utteranceBoundary,
    };
    for (const l of this.listeners) l(chunk);
  }
}
