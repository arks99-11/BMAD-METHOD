/**
 * Shared types for Epic 4 (Text-to-Speech).
 *
 * The `TtsProvider` interface is the single contract every TTS adapter
 * must satisfy: cloud (ElevenLabs, Azure), native (AVSpeech /
 * Android TextToSpeech via Story 4.3a), and the mock adapter used by
 * UI tests all implement the same shape so the engine router (Story
 * 2.5) can swap them at runtime.
 *
 * Two synthesis modes are supported, mirroring the MT layer:
 *
 *  - `synthesize(req): Promise<TtsResult>`  — single-shot. The full
 *    audio is delivered as one `TtsResult.audio` blob (PCM int16 or
 *    encoded depending on the provider). Useful for short utterances
 *    when streaming overhead isn't worth it.
 *
 *  - `synthesizeStream(req): TtsStream`     — streaming. The stream
 *    emits `chunk` events as audio bytes arrive from the wire. The
 *    playback orchestrator (Story 4.5, future PR) feeds chunks into
 *    the audio sink with bounded buffering so end-to-end latency is
 *    near-realtime.
 *
 * Adapters that don't natively stream still implement
 * `synthesizeStream` by emitting one final chunk that contains the
 * entire audio. See `wrapAsTtsStream` in `base-tts-provider.ts`.
 */

import type { LangCode } from '../audio/audio-session-types';

/** Engine label; mirrors `TtsEngineId` in the engine-router. */
export type TtsEngine =
  | 'elevenlabs'
  | 'azure'
  | 'google'
  | 'native'
  | 'mock';

/**
 * Stable error taxonomy. Kept parallel to MT / STT for uniform retry
 * and fallback logic.
 */
export type TtsErrorCode =
  | 'auth'
  | 'network'
  | 'rate-limited'
  | 'unsupported-voice'
  | 'unsupported-language'
  | 'invalid-input'
  | 'engine'
  | 'cancelled'
  | 'unknown';

export class TtsError extends Error {
  readonly code: TtsErrorCode;
  readonly engine: TtsEngine;
  readonly status: number;
  constructor(code: TtsErrorCode, engine: TtsEngine, message: string, status: number = -1) {
    super(message);
    this.code = code;
    this.engine = engine;
    this.status = status;
    this.name = 'TtsError';
  }
}

/**
 * A single synthesis request.
 *
 *  - `text`        : raw text to speak. The provider applies its own
 *                    SSML wrapping if applicable.
 *  - `voice`       : provider-specific voice id (ElevenLabs voice id,
 *                    Azure neural voice name like `en-US-JennyNeural`,
 *                    iOS AVSpeech identifier, etc.). Caller maps the
 *                    user's selection to this id via the voice
 *                    catalog (Story 4.4).
 *  - `language`    : BCP-47 language code, used by Azure for SSML
 *                    `<voice xml:lang="...">` and by native engines.
 *                    Some cloud engines (ElevenLabs Multilingual v2)
 *                    auto-detect from text and ignore this field.
 *  - `rate`        : speech rate multiplier (1.0 = normal). Range
 *                    typically 0.5–2.0; provider clamps if out of range.
 *  - `pitch`       : pitch shift in semitones (0 = unchanged). Most
 *                    cloud engines clamp to ±10.
 *  - `format`      : desired output audio format. Defaults to 'pcm-s16le-16k'
 *                    so the playback path can ingest without decoding.
 *  - `signal`      : `AbortSignal` for cooperative cancellation —
 *                    required by the playback orchestrator for the
 *                    cancel-and-replace pattern (Story 4.5).
 */
export interface TtsRequest {
  text: string;
  voice: string;
  language: LangCode;
  rate?: number;
  pitch?: number;
  format?: TtsAudioFormat;
  signal?: AbortSignal;
}

/**
 * The wire-format options the playback path supports natively.
 *
 *  - `pcm-s16le-16k`: linear int16 PCM @ 16 kHz mono — matches the
 *    capture format and avoids any decoding hop.
 *  - `pcm-s16le-24k`: int16 PCM @ 24 kHz mono — ElevenLabs' default;
 *    the playback path resamples once.
 *  - `mp3-44k`     : MP3 @ 44.1 kHz — fallback for engines that don't
 *    expose PCM.
 *  - `opus-48k`    : Opus @ 48 kHz — Azure's lowest-latency option.
 */
export type TtsAudioFormat = 'pcm-s16le-16k' | 'pcm-s16le-24k' | 'mp3-44k' | 'opus-48k';

export interface TtsResult {
  /** Full audio bytes; encoding implied by `format`. */
  audio: Uint8Array;
  format: TtsAudioFormat;
  engine: TtsEngine;
  voice: string;
  /** Wall-clock duration of the synthesize call. */
  durationMs: number;
  /**
   * Approximate audio duration in milliseconds, if the provider
   * reports it. Used by the playback orchestrator to schedule
   * buffer drains.
   */
  audioDurationMs?: number;
}

export type TtsStreamChunkEvent = {
  type: 'chunk';
  /** Incremental audio bytes. Append to the playback buffer. */
  audio: Uint8Array;
  format: TtsAudioFormat;
};

export type TtsStreamFinalEvent = {
  type: 'final';
  result: TtsResult;
};

export type TtsStreamErrorEvent = {
  type: 'error';
  error: TtsError;
};

export type TtsStreamEvent =
  | TtsStreamChunkEvent
  | TtsStreamFinalEvent
  | TtsStreamErrorEvent;

export type TtsStreamListener = (event: TtsStreamEvent) => void;

export interface TtsStream {
  readonly engine: TtsEngine;
  on(listener: TtsStreamListener): () => void;
  readonly done: Promise<TtsResult>;
}

export interface TtsProvider {
  readonly engine: TtsEngine;
  synthesize(req: TtsRequest): Promise<TtsResult>;
  synthesizeStream(req: TtsRequest): TtsStream;
}
