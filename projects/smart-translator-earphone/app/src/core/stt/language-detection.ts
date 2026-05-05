/**
 * Story 2.4 — Automatic language detection policy.
 *
 * The STT adapters (Google, Whisper) emit `language-detected` events
 * directly. This policy module sits one level higher: it consumes raw
 * `language-detected` events and turns them into actionable
 * UI-facing events:
 *
 *  - `confirmed`            : confidence ≥ confirmThreshold; UI may
 *                             switch corridors automatically and show
 *                             the chip "Detected: <Language>".
 *
 *  - `needs-confirmation`   : minPromptThreshold ≤ confidence <
 *                             confirmThreshold. UI surfaces a
 *                             clickable chip prompting the user to
 *                             confirm the language manually.
 *
 *  - `rejected`             : confidence < minPromptThreshold. We have
 *                             effectively no signal; the UI does
 *                             nothing (the user's explicit
 *                             configuration stays in force).
 *
 * Default thresholds come from Story 2.4's acceptance criteria
 * (`< 0.7` triggers manual confirmation). `minPromptThreshold` is set
 * to 0.3 because asking the user to confirm a guess we ourselves don't
 * believe is worse than not surfacing anything (UX §3.2).
 *
 * The policy also implements the "≥ 4 s" rule from Story 2.4: the very
 * first detection event is suppressed unless the cumulative audio
 * duration is at least the configured `minAudioMs`. The caller is
 * responsible for providing the duration of each chunk via
 * `recordAudio(durationMs)`.
 */

import type { LangCode } from '../audio/audio-session-types';
import type { SttEvent } from './stt-types';

export type DetectionResultKind = 'confirmed' | 'needs-confirmation' | 'rejected';

export interface DetectionResult {
  kind: DetectionResultKind;
  lang: LangCode;
  confidence: number;
  /** Cumulative audio duration observed at the time of detection. */
  audioMs: number;
}

export type DetectionResultListener = (result: DetectionResult) => void;

export interface LanguageDetectionPolicyOptions {
  /** Minimum confidence to auto-switch without asking the user. Default 0.7. */
  confirmThreshold?: number;
  /**
   * Minimum confidence to even bother asking the user. Detections below
   * this are silently dropped. Default 0.3.
   */
  minPromptThreshold?: number;
  /**
   * Minimum cumulative audio duration before any detection is surfaced.
   * Default 4000 ms (Story 2.4 acceptance criteria).
   */
  minAudioMs?: number;
  /**
   * If true, only emit the first detection event per session. After the
   * first emit, subsequent `language-detected` events are ignored. The
   * UI can re-arm by constructing a fresh policy. Default true.
   */
  emitOnce?: boolean;
}

export class LanguageDetectionPolicy {
  private readonly confirmThreshold: number;
  private readonly minPromptThreshold: number;
  private readonly minAudioMs: number;
  private readonly emitOnce: boolean;
  private audioMs = 0;
  private emitted = false;
  private readonly listeners = new Set<DetectionResultListener>();

  constructor(opts: LanguageDetectionPolicyOptions = {}) {
    this.confirmThreshold = opts.confirmThreshold ?? 0.7;
    this.minPromptThreshold = opts.minPromptThreshold ?? 0.3;
    this.minAudioMs = opts.minAudioMs ?? 4_000;
    this.emitOnce = opts.emitOnce ?? true;
    if (this.confirmThreshold < this.minPromptThreshold) {
      throw new Error(
        'LanguageDetectionPolicy: confirmThreshold must be ≥ minPromptThreshold.',
      );
    }
  }

  on(listener: DetectionResultListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Record the duration of an audio chunk that was just sent to the
   * STT engine. Updates the policy's running audio counter so that the
   * `≥ 4 s` rule fires correctly.
   */
  recordAudio(durationMs: number): void {
    if (durationMs < 0) return;
    this.audioMs += durationMs;
  }

  /**
   * Apply the policy to a single STT event. Returns the produced
   * `DetectionResult` if any (so callers can short-circuit), or null if
   * the event is filtered out.
   *
   * Listeners attached via `on()` are notified at the same time.
   */
  apply(event: SttEvent): DetectionResult | null {
    if (event.type !== 'language-detected') return null;
    if (this.emitOnce && this.emitted) return null;
    if (this.audioMs < this.minAudioMs) return null;

    let kind: DetectionResultKind;
    if (event.confidence >= this.confirmThreshold) {
      kind = 'confirmed';
    } else if (event.confidence >= this.minPromptThreshold) {
      kind = 'needs-confirmation';
    } else {
      kind = 'rejected';
    }
    if (kind === 'rejected') {
      // Still consumes the "first event" budget so that a rejected
      // detection isn't replaced by another marginal one in the same
      // session — Story 2.4's UX explicitly does not want chip flicker.
      this.emitted = true;
      return null;
    }
    const result: DetectionResult = {
      kind,
      lang: event.lang,
      confidence: event.confidence,
      audioMs: this.audioMs,
    };
    this.emitted = true;
    for (const l of this.listeners) {
      l(result);
    }
    return result;
  }

  /**
   * Reset the policy's "already emitted" / "audio counter" state so it
   * can run again. Useful when the user changes the source language
   * manually and we want to re-engage detection.
   */
  reset(): void {
    this.audioMs = 0;
    this.emitted = false;
  }
}
