/**
 * Shared types for Epic 2 (Speech-to-Text Integration).
 *
 * The `STTProvider` interface is the single contract every STT adapter must
 * satisfy. Cloud adapters (Deepgram, Google), on-device adapters
 * (Whisper.cpp), and the mock adapter used by UI tests all implement the
 * same shape so the engine router (Story 2.5) can swap them at runtime.
 *
 * Frame format consumed by an STTProvider is fixed by the audio pipeline:
 *   - 16 kHz mono int16 PCM
 *   - delivered as `AudioChunk`s (multiple 20 ms frames coalesced)
 *
 * See `core/audio/audio-types.ts` for the canonical frame definition and
 * project-context.md rule 1 (frame format is non-negotiable).
 */

import type { AudioChunk } from '../audio/audio-types';
import type { LangCode } from '../audio/audio-session-types';

/**
 * Engine label used for telemetry, the "engine transparency" UI sheet, and
 * the engine router's policy decisions. New adapters extend this union.
 */
export type SttEngine = 'deepgram' | 'google' | 'whisper-on-device' | 'mock';

/**
 * Stable error taxonomy. Adapters must map their vendor-specific error
 * codes onto this union so callers can implement uniform retry / fallback
 * logic. See project-context.md rule 15: network errors are retryable;
 * permission errors are not.
 */
export type SttErrorCode =
  | 'auth' // bad/missing credential — caller must refresh; not retryable.
  | 'network' // socket closed, fetch failed, DNS — retryable.
  | 'rate-limited' // 429 / quota — retryable with backoff.
  | 'unsupported-language' // engine doesn't speak this language — caller should re-route.
  | 'invalid-audio' // sample-rate / format mismatch — bug; not retryable.
  | 'engine' // upstream returned a non-recoverable error.
  | 'cancelled' // session was cancelled by the caller.
  | 'unknown';

/**
 * Discriminated union emitted by an STT session.
 *
 *  - `partial`    : interim transcript; will be revised. UI may render it
 *                   greyed-out / italic per UX §3.2.
 *  - `final`      : finalised transcript for an utterance. UI promotes it to
 *                   the canonical chat bubble.
 *  - `language-detected` : auto-detect result (Story 2.4). May fire before
 *                          the first `final`; `confidence` ∈ [0, 1].
 *  - `error`      : something went wrong; `code` is the stable error code,
 *                   `message` is a human-readable description (already
 *                   translated, never a raw exception per rule 14).
 *  - `closed`     : session has terminated. No further events will arrive.
 */
export type SttEvent =
  | { type: 'partial'; transcript: string; confidence?: number; lang?: LangCode }
  | { type: 'final'; transcript: string; confidence?: number; lang?: LangCode }
  | { type: 'language-detected'; lang: LangCode; confidence: number }
  | { type: 'error'; code: SttErrorCode; message: string }
  | { type: 'closed' };

export type SttEventListener = (event: SttEvent) => void;

/**
 * Options passed to `STTProvider.start()`.
 *
 *  - `lang`             : initial language hint. May be revised by a
 *                         subsequent `language-detected` event.
 *  - `interimResults`   : enable partial transcripts. Defaults to true.
 *                         Callers running in lecture mode (FR-2) may keep
 *                         this on; callers running in offline-only mode may
 *                         disable it to save battery.
 *  - `autoLanguageDetect`: enable language detection (Story 2.4). The
 *                          adapter will silently no-op if the underlying
 *                          engine doesn't support it (e.g. Deepgram's WS
 *                          API does not, per V-05).
 *  - `signal`           : optional `AbortSignal` for cooperative
 *                         cancellation. Aborting tears down the connection
 *                         and emits `error{code:'cancelled'}` then `closed`.
 */
export interface SttStartOptions {
  lang: LangCode;
  interimResults?: boolean;
  autoLanguageDetect?: boolean;
  signal?: AbortSignal;
}

/**
 * A live STT session.
 *
 * The lifecycle is:
 *   1. provider.start(opts) → SttSession
 *   2. session.send(chunk) repeatedly as audio chunks arrive
 *   3. session.end() to signal end-of-stream; the adapter will flush
 *      whatever transcripts remain and then emit `closed`.
 *
 * Callers MUST call `end()` exactly once. Calling `send()` after `end()`
 * (or after the session has emitted `closed`) is a programmer error and
 * will throw.
 */
export interface SttSession {
  readonly engine: SttEngine;
  send(chunk: AudioChunk): void;
  end(): Promise<void>;
  on(listener: SttEventListener): () => void;
}

/**
 * The uniform STT contract. Every adapter implements `start()`. The engine
 * router (Story 2.5) holds a registry of `STTProvider`s keyed by `SttEngine`
 * and resolves the right one per language corridor at session start time.
 */
export interface SttProvider {
  readonly engine: SttEngine;
  start(opts: SttStartOptions): Promise<SttSession>;
}
