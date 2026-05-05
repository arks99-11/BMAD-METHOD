/**
 * Story 4.5 — Playback orchestrator.
 *
 * Sits between the translation orchestrator (Epic 3 Story 3.5) and
 * the active `TtsProvider`. Acceptance criteria from the PRD:
 *
 *  - **Cancel-and-replace**: when a new translation arrives while a
 *    previous TTS is still playing, cancel the previous one (call
 *    AbortController.abort on its synthesis request) and start a new
 *    synthesis. The audio sink should fade-out the previous audio
 *    over ~30 ms so the cut isn't audible as a click.
 *
 *  - **Chunk pipeline**: as audio chunks stream from the provider,
 *    feed them to the audio sink immediately so playback starts as
 *    early as possible. The sink is a callback (`onAudioChunk`) that
 *    the React Native shell wires to `audio-playback`.
 *
 *  - **Native engine pass-through**: when `engine === 'native'`, the
 *    bridge plays through the device speaker directly. The
 *    orchestrator still issues the synthesize call (to participate in
 *    cancellation) but does NOT forward chunks to the sink.
 *
 *  - **Final-only mode**: when the upstream emits a partial
 *    translation while we're already playing, we DROP the partial.
 *    Only finals trigger a fresh synthesis. (The translation
 *    orchestrator decides whether a result is partial or final;
 *    `submitTranslation({ partial: true })` is only used by the
 *    UI to render text — never to drive TTS.)
 *
 * The orchestrator is provider-agnostic — works with `ElevenLabsProvider`,
 * `AzureTtsProvider`, `NativeTtsProvider`, or a mock.
 */

import type {
  TtsProvider,
  TtsRequest,
  TtsResult,
  TtsAudioFormat,
  TtsError,
} from './tts-types';

export type TtsPlaybackEvent =
  | { type: 'started' }
  | { type: 'chunk'; audio: Uint8Array; format: TtsAudioFormat }
  | { type: 'completed'; result: TtsResult }
  | { type: 'cancelled' }
  | { type: 'error'; error: TtsError };

export type TtsPlaybackListener = (event: TtsPlaybackEvent) => void;

export interface PlaybackOrchestratorOptions {
  provider: TtsProvider;
  /** Called for each non-native audio chunk. Wire to `audio-playback`. */
  onAudioChunk?: (audio: Uint8Array, format: TtsAudioFormat) => void;
}

export interface SynthesisRequest {
  text: string;
  voice: string;
  language: string;
  rate?: number;
  pitch?: number;
  format?: TtsAudioFormat;
}

interface ActiveSynthesis {
  controller: AbortController;
}

export class PlaybackOrchestrator {
  private readonly provider: TtsProvider;
  private readonly onAudioChunk: ((audio: Uint8Array, format: TtsAudioFormat) => void) | undefined;
  private readonly listeners = new Set<TtsPlaybackListener>();
  private active: ActiveSynthesis | null = null;

  constructor(opts: PlaybackOrchestratorOptions) {
    this.provider = opts.provider;
    this.onAudioChunk = opts.onAudioChunk;
  }

  on(listener: TtsPlaybackListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Submit a final translation for synthesis. Cancels any in-flight
   * playback. No-op for empty / whitespace-only text.
   */
  submit(req: SynthesisRequest): void {
    if (req.text.trim().length === 0) return;
    this.cancelActive('replace');
    this.startSynthesis(req);
  }

  /**
   * Cancel the current playback without starting a new one. Used when
   * the user manually mutes / pauses, or on session end.
   */
  reset(): void {
    this.cancelActive('drop');
  }

  private cancelActive(mode: 'replace' | 'drop'): void {
    if (this.active === null) return;
    this.active.controller.abort();
    this.active = null;
    if (mode === 'replace') {
      this.emit({ type: 'cancelled' });
    }
  }

  private startSynthesis(req: SynthesisRequest): void {
    const controller = new AbortController();
    this.active = { controller };

    const ttsReq: TtsRequest = {
      text: req.text,
      voice: req.voice,
      language: req.language,
      ...(req.rate !== undefined ? { rate: req.rate } : {}),
      ...(req.pitch !== undefined ? { pitch: req.pitch } : {}),
      ...(req.format !== undefined ? { format: req.format } : {}),
      signal: controller.signal,
    };
    const isNative = this.provider.engine === 'native';
    const stream = this.provider.synthesizeStream(ttsReq);
    stream.done.catch(() => undefined);

    let started = false;
    stream.on((ev) => {
      if (this.active?.controller !== controller) return; // pre-empted
      if (ev.type === 'chunk') {
        if (!started) {
          started = true;
          this.emit({ type: 'started' });
        }
        if (!isNative) {
          this.onAudioChunk?.(ev.audio, ev.format);
        }
        this.emit({ type: 'chunk', audio: ev.audio, format: ev.format });
      } else if (ev.type === 'final') {
        if (this.active?.controller === controller) {
          this.active = null;
        }
        if (!started) {
          // Single-shot adapters: emit started once before completed
          // so listeners observe the same lifecycle.
          this.emit({ type: 'started' });
        }
        this.emit({ type: 'completed', result: ev.result });
      } else if (ev.type === 'error') {
        if (ev.error.code === 'cancelled') {
          // Pre-emption already emitted 'cancelled'; suppress.
          return;
        }
        if (this.active?.controller === controller) {
          this.active = null;
        }
        this.emit({ type: 'error', error: ev.error });
      }
    });
  }

  private emit(ev: TtsPlaybackEvent): void {
    for (const l of this.listeners) {
      l(ev);
    }
  }
}
