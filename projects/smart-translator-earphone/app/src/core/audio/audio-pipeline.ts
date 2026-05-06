/**
 * Orchestrator that composes Stories 1.1 → 1.5 into a single audio pipeline.
 *
 * Wiring:
 *
 *     AudioCaptureProvider
 *           │ frame
 *           ▼
 *     [HighPassFilter]
 *           │
 *           ▼
 *     [VAD] ─── utterance-start ───► consumer
 *           │
 *           │ frame (only voiced frames if `onlyVoiced` is true)
 *           ▼
 *     [AudioChunker]
 *           │ chunk
 *           ▼
 *      consumer (e.g. STT adapter)
 *
 * The pipeline does NOT own the playback queue — it is symmetric / output-side
 * and is wired by the engine router. The pipeline does, however, expose the
 * playback queue's lifecycle hook so the orchestrator can stop the session
 * cleanly.
 *
 * The pipeline is intentionally event-driven and synchronous; tests assert
 * exact event sequences without dealing with Promises.
 */

import { AudioCaptureProvider } from './audio-capture';
import { AudioChunker, ChunkerOptions } from './audio-chunker';
import { AudioChunk, AudioFrame, VadEvent } from './audio-types';
import { HighPassFilter, HighPassFilterOptions } from './noise-reduction';
import { VadOptions, VoiceActivityDetector } from './vad';

export interface AudioPipelineOptions {
  vad?: Partial<VadOptions>;
  chunker?: Partial<ChunkerOptions>;
  highPass?: Partial<HighPassFilterOptions> | false;
  /**
   * If true, only voiced frames (between utterance-start and utterance-end)
   * are routed to the chunker. If false, all frames are chunked.
   * Default: true.
   */
  onlyVoicedFramesToChunker?: boolean;
}

export type PipelineListener = (event: PipelineEvent) => void;
export type PipelineEvent =
  | { type: 'frame'; frame: AudioFrame }
  | VadEvent
  | { type: 'chunk'; chunk: AudioChunk };

export class AudioPipeline {
  readonly vad: VoiceActivityDetector;
  readonly chunker: AudioChunker;
  readonly highPass: HighPassFilter | null;
  private readonly listeners = new Set<PipelineListener>();
  private capturing = false;
  private inUtterance = false;
  private lastFrame: AudioFrame | null = null;
  private unsubscribeFrame: (() => void) | null = null;
  private readonly opts: Required<Pick<AudioPipelineOptions, 'onlyVoicedFramesToChunker'>>;

  constructor(
    private readonly capture: AudioCaptureProvider,
    options: AudioPipelineOptions = {},
  ) {
    this.vad = new VoiceActivityDetector(options.vad);
    this.chunker = new AudioChunker(options.chunker);
    this.highPass = options.highPass === false ? null : new HighPassFilter(options.highPass ?? {});
    this.opts = { onlyVoicedFramesToChunker: options.onlyVoicedFramesToChunker ?? true };

    this.vad.onEvent((ev) => {
      if (ev.type === 'utterance-start') {
        this.inUtterance = true;
      } else if (ev.type === 'utterance-end') {
        this.inUtterance = false;
        this.chunker.markUtteranceBoundary();
      }
      this.emit(ev);
    });

    this.chunker.onChunk((c) => this.emit({ type: 'chunk', chunk: c }));
  }

  async start(): Promise<void> {
    if (this.capturing) return;
    this.unsubscribeFrame = this.capture.onFrame((f) => this.handleFrame(f));
    this.capturing = true;
    await this.capture.start();
  }

  async stop(): Promise<void> {
    if (!this.capturing) return;
    this.capturing = false;
    await this.capture.stop();
    if (this.unsubscribeFrame) {
      this.unsubscribeFrame();
      this.unsubscribeFrame = null;
    }
    // Order matters: flush the chunker's buffered frames FIRST as a final
    // chunk (so an in-progress utterance produces an end-of-stream chunk),
    // then let the VAD emit any pending utterance-end. Doing it the other
    // way around would route the buffered frames out via markUtteranceBoundary
    // and flushFinal would have nothing to emit.
    //
    // When we are mid-utterance at stop time, the final chunk is also at an
    // utterance boundary (the VAD's about-to-fire utterance-end belongs to
    // the same frame range). Tag the chunk accordingly so STT consumers can
    // treat it as both end-of-stream and end-of-utterance.
    this.chunker.flushFinal({ utteranceBoundary: this.inUtterance });
    this.vad.flush(this.lastFrame);
  }

  on(listener: PipelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleFrame(frame: AudioFrame): void {
    let processed = frame;
    if (this.highPass) {
      const out = new Int16Array(frame.samples.length);
      this.highPass.process(frame.samples, out);
      processed = { ...frame, samples: out };
    }
    this.lastFrame = processed;
    this.emit({ type: 'frame', frame: processed });
    this.vad.push(processed);
    if (!this.opts.onlyVoicedFramesToChunker || this.inUtterance) {
      this.chunker.push(processed);
    }
  }

  private emit(ev: PipelineEvent): void {
    for (const l of this.listeners) l(ev);
  }
}
