/**
 * Shared types for Epic 3 (Translation Engine).
 *
 * The `MtProvider` interface is the single contract every MT adapter
 * must satisfy. Cloud adapters (DeepL, Google, GPT-4o-mini), the
 * on-device NLLB adapter (Story 3.4), and the mock adapter used by UI
 * tests all implement the same shape so the engine router (Story 2.5)
 * can swap them at runtime.
 *
 * Two translation modes are supported:
 *
 *  - Single-shot   : `translate(req)` resolves once with the full
 *                    translation. Used by DeepL and Google REST adapters.
 *
 *  - Streaming     : `translateStream(req)` returns an `MtStream` whose
 *                    `on('chunk', ...)` listener fires as tokens arrive.
 *                    Used by GPT-4o-mini (Story 3.3) and any future
 *                    streaming-capable vendor.
 *
 * Adapters that don't natively stream still implement `translateStream`
 * by emitting one final chunk that contains the entire translation;
 * callers don't need to branch on whether the underlying engine
 * supports streaming. See `BaseMtProvider.translateStream` (planned for
 * a future PR).
 */

import type { LangCode } from '../audio/audio-session-types';

/**
 * Engine label used for telemetry and the engine-transparency UI sheet.
 *
 * Mirrors `MtEngineId` in `core/engine-router/types.ts`. Kept duplicated
 * here so an MT adapter can be used standalone (without depending on
 * the router types) when integrating in tests.
 */
export type MtEngine =
  | 'deepl'
  | 'google'
  | 'gpt-4o-mini'
  | 'nllb-on-device'
  | 'naver-papago'
  | 'mock';

/**
 * Stable error taxonomy. Mirrors `SttErrorCode` so callers can write
 * uniform retry / fallback logic across STT and MT.
 */
export type MtErrorCode =
  | 'auth'
  | 'network'
  | 'rate-limited'
  | 'unsupported-pair'
  | 'invalid-input'
  | 'engine'
  | 'cancelled'
  | 'unknown';

export class MtError extends Error {
  readonly code: MtErrorCode;
  readonly engine: MtEngine;
  /** HTTP status if applicable; -1 if not. */
  readonly status: number;

  constructor(code: MtErrorCode, engine: MtEngine, message: string, status: number = -1) {
    super(message);
    this.code = code;
    this.engine = engine;
    this.status = status;
    this.name = 'MtError';
  }
}

/**
 * A single translation request.
 *
 *  - `text`        : raw source text. The provider preserves whitespace
 *                    where possible.
 *  - `source`      : BCP-47 language code or `'auto'` for vendor-side
 *                    detection (DeepL, Google support `auto`).
 *  - `target`      : BCP-47 language code; required.
 *  - `formality`   : DeepL-specific hint. Other vendors ignore it.
 *  - `glossary`    : explicit term mappings the vendor must honour
 *                    (DeepL has built-in support; Google supports it via
 *                    custom models; GPT-4o-mini implements it via prompt
 *                    injection in Story 3.3).
 *  - `signal`      : optional `AbortSignal` for cooperative cancellation.
 */
export interface MtRequest {
  text: string;
  source: LangCode | 'auto';
  target: LangCode;
  formality?: 'default' | 'more' | 'less' | 'prefer_more' | 'prefer_less';
  glossary?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
}

export interface MtResult {
  /** The translated text. */
  text: string;
  /**
   * The detected source language, if the request used `source: 'auto'`
   * and the vendor returned one. Absent for explicit-source requests.
   */
  detectedSource?: LangCode;
  /** Engine that produced the translation. */
  engine: MtEngine;
  /**
   * Wall-clock duration of the translate call, in milliseconds. Useful
   * for the telemetry pipeline (Story 10.1) without forcing every
   * caller to time the call themselves.
   */
  durationMs: number;
  /**
   * Stable correlation id; passes through to telemetry so a translation
   * can be matched to its STT input and TTS output.
   */
  correlationId?: string;
}

export type MtStreamChunkEvent = {
  type: 'chunk';
  /** Incremental text. Append to the running buffer. */
  text: string;
};
export type MtStreamFinalEvent = {
  type: 'final';
  result: MtResult;
};
export type MtStreamErrorEvent = {
  type: 'error';
  error: MtError;
};
export type MtStreamEvent = MtStreamChunkEvent | MtStreamFinalEvent | MtStreamErrorEvent;

export type MtStreamListener = (event: MtStreamEvent) => void;

/**
 * A streaming translation. Lifecycle:
 *
 *   1. provider.translateStream(req) -> MtStream
 *   2. stream.on(listener) — listener receives chunk / final / error.
 *   3. After `final` or `error`, the stream is closed; further
 *      listeners receive only the cached final/error event (replay).
 *
 * `await stream.done` resolves with the final `MtResult` (or rejects
 * with an `MtError`) — convenient for non-streaming consumers.
 */
export interface MtStream {
  readonly engine: MtEngine;
  on(listener: MtStreamListener): () => void;
  readonly done: Promise<MtResult>;
}

export interface MtProvider {
  readonly engine: MtEngine;
  translate(req: MtRequest): Promise<MtResult>;
  translateStream(req: MtRequest): MtStream;
}
