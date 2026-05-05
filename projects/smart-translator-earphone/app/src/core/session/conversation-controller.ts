/**
 * Story 5.2 — Conversation Mode controller.
 *
 * Wires together the existing pure-TS modules into a single session:
 *
 *   AudioPipeline → SttProvider.start() → SttSession events
 *      └── partial / final transcripts → TranslationOrchestrator
 *           └── partial / final translations → PlaybackOrchestrator
 *                └── audio chunks → AudioPlaybackProvider
 *
 * The controller is framework-agnostic — the React Native UI (Stories
 * 5.1 / 5.2 view layer) consumes its events via `on(listener)` and
 * issues commands via `start()` / `stop()`. Tests inject mocks.
 *
 * Engine selection goes through `EngineRouter.decide()` at session
 * start. The controller resolves the decision against its provider
 * registry (a Map keyed by engine id). If a registry entry is missing,
 * the controller errors out — registries should be fully populated by
 * the boot sequence.
 *
 * NOTE: this PR ships the controller's plumbing & tests. The
 * end-to-end "press mic, hear translation" flow requires the React
 * Native shell (PR #10) to wire AudioCaptureProvider and
 * AudioPlaybackProvider to native modules; until then the controller
 * runs against the pure-TS Mock implementations from Epic 1.
 */

import { AudioChunker, type ChunkerOptions } from '../audio/audio-chunker';
import type {
  AudioCaptureProvider,
  CaptureState,
  FrameListener,
} from '../audio/audio-capture';

import type { AudioChunk, AudioFrame } from '../audio/audio-types';
import type { LangCode } from '../audio/audio-session-types';
import type { EngineRouter } from '../engine-router/engine-router';
import type {
  CorridorPolicy,
  MtEngineId,
  RouteDecision,
  SttEngineId,
  TtsEngineId,
} from '../engine-router/types';
import type {
  MtProvider,
  MtRequest,
  MtStream,
} from '../mt/mt-types';
import { TranslationOrchestrator } from '../mt/translation-orchestrator';
import type { SttProvider, SttSession } from '../stt/stt-types';
import { PlaybackOrchestrator } from '../tts/playback-orchestrator';
import type {
  TtsAudioFormat,
  TtsProvider,
} from '../tts/tts-types';
import type { CatalogVoice, VoiceCatalog } from '../tts/voice-catalog';
import type {
  EngineTransparency,
  SessionEvent,
  SessionListener,
  SessionSnapshot,
  SessionStartOptions,
  SessionState,
  TurnPair,
} from './session-types';
import { RollingLatencyTracker } from './transparency';
import { TurnLog } from './turn-log';

export interface ConversationControllerOptions {
  capture: AudioCaptureProvider;
  /**
   * Sink for synthesised audio chunks. The RN shell wires this to a
   * decoder + `AudioPlaybackQueue`. The controller does NOT decode mp3
   * / opus — it forwards the raw bytes and the format. PCM chunks can
   * be passed straight to `AudioPlaybackQueue.enqueue` after a
   * Uint8Array→Int16Array view conversion.
   *
   * Native TTS engines emit no chunks (the engine plays directly
   * through the device speaker), so this callback is never called for
   * `tts === 'native'`.
   */
  onSynthesisAudio?: (audio: Uint8Array, format: TtsAudioFormat) => void;
  router: EngineRouter;
  voices: VoiceCatalog;
  sttRegistry: Map<SttEngineId, SttProvider>;
  mtRegistry: Map<MtEngineId, MtProvider>;
  ttsRegistry: Map<TtsEngineId, TtsProvider>;
  /** Audio chunker config; defaults match Epic 1. */
  chunker?: ChunkerOptions;
  /** TTS playback chunk format hint; defaults to PCM 24k. */
  ttsFormat?: TtsAudioFormat;
}

interface ActiveSession {
  decision: RouteDecision;
  voice: CatalogVoice;
  source: LangCode;
  target: LangCode;
  sttSession: SttSession;
  translation: TranslationOrchestrator;
  playback: PlaybackOrchestrator;
  detachStt: () => void;
  detachTrans: () => void;
  detachPlay: () => void;
  detachCapture: () => void;
  startedAtMs: number;
  pendingTurnId: string | null;
  /** Per-turn timestamps for latency. */
  utteranceStartMs: number | null;
  sttFinalAtMs: number | null;
  mtFinalAtMs: number | null;
}

export class ConversationController {
  private readonly opts: ConversationControllerOptions;
  private readonly listeners = new Set<SessionListener>();
  private readonly turnLog = new TurnLog();
  private readonly latency = new RollingLatencyTracker();
  private state: SessionState = 'idle';
  private active: ActiveSession | null = null;
  private transparency: EngineTransparency | null = null;
  private chunker: AudioChunker | null = null;

  constructor(opts: ConversationControllerOptions) {
    this.opts = opts;
  }

  on(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): SessionSnapshot {
    const snap: SessionSnapshot = {
      state: this.state,
      turns: this.turnLog.list(),
    };
    if (this.transparency !== null) snap.transparency = this.transparency;
    if (this.active !== null) {
      snap.lastDecision = {
        policy: this.active.decision.policy,
        reason: this.active.decision.reason,
        corridor: this.active.decision.matchedCorridor,
      };
    }
    return snap;
  }

  /** Start a new session. Throws if a session is already running. */
  async start(options: SessionStartOptions): Promise<void> {
    if (this.active !== null) {
      throw new Error('ConversationController: session already running.');
    }
    this.turnLog.clear();

    const decision = this.opts.router.decide({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      online: options.online ?? true,
      cloudOff: options.cloudOff ?? false,
      tier: options.tier,
      ...(options.contextAware !== undefined ? { contextAware: options.contextAware } : {}),
    });
    const policy = decision.policy;

    const voice = this.opts.voices.get(options.voiceId);
    if (voice === undefined) {
      throw new Error(`ConversationController: unknown voice ${options.voiceId}.`);
    }

    const sttProvider = this.opts.sttRegistry.get(policy.stt);
    const mtProvider = this.opts.mtRegistry.get(policy.mt);
    const ttsProvider = this.opts.ttsRegistry.get(policy.tts);
    if (sttProvider === undefined) {
      throw new Error(`ConversationController: STT provider ${policy.stt} not registered.`);
    }
    if (mtProvider === undefined) {
      throw new Error(`ConversationController: MT provider ${policy.mt} not registered.`);
    }
    if (ttsProvider === undefined) {
      throw new Error(`ConversationController: TTS provider ${policy.tts} not registered.`);
    }

    const translation = new TranslationOrchestrator({ provider: mtProvider });
    const playback = new PlaybackOrchestrator({
      provider: ttsProvider,
      onAudioChunk: (audio, format): void => {
        this.opts.onSynthesisAudio?.(audio, format);
      },
    });

    const sttSession = await sttProvider.start({
      lang: options.sourceLang,
      interimResults: true,
      autoLanguageDetect: true,
    });

    const detachStt = sttSession.on((ev) => {
      if (this.active === null) return;
      if (ev.type === 'partial') {
        this.handleSttPartial(ev.transcript, ev.lang);
      } else if (ev.type === 'final') {
        this.handleSttFinal(ev.transcript, ev.lang, options);
      } else if (ev.type === 'language-detected') {
        this.emit({ type: 'language-detected', lang: ev.lang, confidence: ev.confidence });
        if (this.active !== null) {
          this.active.source = ev.lang;
        }
      } else if (ev.type === 'error') {
        this.fail(`STT error: ${ev.message}`);
      }
    });

    const detachTrans = translation.on((ev) => {
      if (this.active === null) return;
      if (ev.type === 'partial') {
        this.handleMtPartial(ev.result.text);
      } else if (ev.type === 'final') {
        this.handleMtFinal(ev.result.text, voice, options.targetLang);
      } else if (ev.type === 'cancelled') {
        // Pre-emption of an MT call — the older partial is no longer
        // valid, but we don't need to surface anything to the UI. The
        // newer partial will rewrite the target side.
      } else if (ev.type === 'error') {
        this.fail(`MT error: ${ev.error.message}`);
      }
    });

    const detachPlay = playback.on((ev) => {
      if (this.active === null) return;
      if (ev.type === 'started') {
        this.setState('speaking');
      } else if (ev.type === 'completed') {
        if (this.active.mtFinalAtMs !== null) {
          this.latency.push('tts', Date.now() - this.active.mtFinalAtMs);
          this.publishTransparency();
        }
        this.setState('listening');
      } else if (ev.type === 'cancelled') {
        // A new translation pre-empted us — UI doesn't need a state
        // change because we're flowing into another `started`.
      } else if (ev.type === 'error') {
        this.fail(`TTS error: ${ev.error.message}`);
      }
    });

    const onFrame: FrameListener = (frame) => this.handleFrame(frame);
    this.chunker = new AudioChunker(this.opts.chunker ?? {});
    this.chunker.onChunk((chunk: AudioChunk): void => {
      if (this.active === null) return;
      this.active.sttSession.send(chunk);
    });
    const detachCapture = this.opts.capture.onFrame(onFrame);

    this.active = {
      decision,
      voice,
      source: options.sourceLang,
      target: options.targetLang,
      sttSession,
      translation,
      playback,
      detachStt,
      detachTrans,
      detachPlay,
      detachCapture,
      startedAtMs: Date.now(),
      pendingTurnId: null,
      utteranceStartMs: null,
      sttFinalAtMs: null,
      mtFinalAtMs: null,
    };

    await this.opts.capture.start();
    this.setState('listening');
    this.publishTransparency();
    void detachCapture; // stored on active.detachCapture above
  }

  /** Stop the current session and tear everything down. */
  async stop(): Promise<void> {
    const a = this.active;
    if (a === null) return;
    this.active = null;
    a.detachStt();
    a.detachTrans();
    a.detachPlay();
    a.detachCapture();
    if (this.chunker !== null) {
      this.chunker.flushFinal();
      this.chunker = null;
    }
    a.translation.reset();
    a.playback.reset();
    try {
      await this.opts.capture.stop();
    } catch {
      // Ignore — best-effort.
    }
    try {
      await a.sttSession.end();
    } catch {
      // Ignore — best-effort.
    }
    this.setState('idle');
  }

  private handleFrame(frame: AudioFrame): void {
    if (this.chunker !== null) this.chunker.push(frame);
    if (this.active !== null && this.active.utteranceStartMs === null) {
      this.active.utteranceStartMs = Date.now();
    }
  }

  private handleSttPartial(text: string, lang: LangCode | undefined): void {
    const a = this.active!;
    if (a.pendingTurnId === null) {
      const turn = this.turnLog.openTurn(lang ?? a.source, a.target, Date.now() - a.startedAtMs);
      a.pendingTurnId = turn.id;
      this.emit({ type: 'turn-appended', turn });
    } else if (lang !== undefined) {
      this.turnLog.updateSourceLang(a.pendingTurnId, lang);
    }
    const updated = this.turnLog.updateSourcePartial(a.pendingTurnId, text);
    if (updated !== undefined) {
      this.emit({ type: 'turn-updated', turn: updated });
    }
    if (this.state === 'listening' && text.trim().length > 0) {
      // First partial of a new utterance.
      this.setState('translating');
    }
    a.translation.submitPartial(this.buildMtRequest(text, lang));
  }

  private handleSttFinal(
    text: string,
    lang: LangCode | undefined,
    options: SessionStartOptions,
  ): void {
    const a = this.active!;
    if (a.pendingTurnId === null) {
      const turn = this.turnLog.openTurn(lang ?? a.source, a.target, Date.now() - a.startedAtMs);
      a.pendingTurnId = turn.id;
      this.emit({ type: 'turn-appended', turn });
    } else if (lang !== undefined) {
      this.turnLog.updateSourceLang(a.pendingTurnId, lang);
    }
    const updated = this.turnLog.commitSourceFinal(a.pendingTurnId, text);
    if (updated !== undefined) {
      this.emit({ type: 'turn-updated', turn: updated });
    }
    if (a.utteranceStartMs !== null) {
      this.latency.push('stt', Date.now() - a.utteranceStartMs);
    }
    a.sttFinalAtMs = Date.now();
    a.translation.submitFinal(this.buildMtRequest(text, lang));
    void options;
  }

  private handleMtPartial(text: string): void {
    const a = this.active!;
    if (a.pendingTurnId === null) return;
    const updated = this.turnLog.updateTargetPartial(a.pendingTurnId, text);
    if (updated !== undefined) {
      this.emit({ type: 'turn-updated', turn: updated });
    }
  }

  private handleMtFinal(
    text: string,
    voice: CatalogVoice,
    targetLang: LangCode,
  ): void {
    const a = this.active!;
    if (a.pendingTurnId === null) return;
    const updated = this.turnLog.commitTargetFinal(a.pendingTurnId, text, Date.now());
    if (updated !== undefined) {
      this.emit({ type: 'turn-updated', turn: updated });
    }
    if (a.sttFinalAtMs !== null) {
      this.latency.push('mt', Date.now() - a.sttFinalAtMs);
    }
    a.mtFinalAtMs = Date.now();
    a.pendingTurnId = null;
    a.utteranceStartMs = null;
    a.sttFinalAtMs = null;
    this.publishTransparency();

    a.playback.submit({
      text,
      voice: voice.providerVoiceId,
      language: targetLang,
      ...(this.opts.ttsFormat !== undefined ? { format: this.opts.ttsFormat } : {}),
    });
  }

  private buildMtRequest(text: string, lang: LangCode | undefined): MtRequest {
    const a = this.active!;
    return {
      text,
      source: lang ?? a.source,
      target: a.target,
    };
  }

  private setState(s: SessionState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit({ type: 'state', state: s });
  }

  private fail(message: string): void {
    this.state = 'error';
    this.emit({ type: 'state', state: 'error' });
    this.emit({ type: 'error', message });
  }

  private publishTransparency(): void {
    const a = this.active;
    if (a === null) return;
    const data: EngineTransparency = {
      stt: a.decision.policy.stt,
      mt: a.decision.policy.mt,
      tts: a.decision.policy.tts,
      reason: a.decision.reason,
      corridor: a.decision.matchedCorridor,
      latency: {
        ...(this.latency.mean('stt') !== undefined ? { sttMs: this.latency.mean('stt') } : {}),
        ...(this.latency.mean('mt') !== undefined ? { mtMs: this.latency.mean('mt') } : {}),
        ...(this.latency.mean('tts') !== undefined ? { ttsMs: this.latency.mean('tts') } : {}),
      },
    };
    this.transparency = data;
    this.emit({ type: 'transparency', data });
  }

  private emit(ev: SessionEvent): void {
    for (const l of this.listeners) l(ev);
  }
}

/* Re-exports so consumers don't need to chase types across files. */
export type { CorridorPolicy, MtStream, CaptureState, TurnPair };
