/**
 * Story 2.2 — Google Cloud Speech-to-Text adapter.
 *
 * Google's streaming recognition is exposed over gRPC bidirectional
 * streaming (`speech.googleapis.com:443`). gRPC streaming requires a
 * native HTTP/2 transport that is awkward to express in pure TypeScript
 * without pulling in `@google-cloud/speech` (which has native bindings).
 *
 * To keep this PR pure-TS / CI-runnable / mockable, the adapter is split
 * into two layers:
 *
 *   1. `GoogleSttProvider` — implements `SttProvider`. Translates
 *      `AudioChunk`s into the discriminated `SttEvent` union.
 *
 *   2. `GoogleSttTransport` — the injectable boundary. The default
 *      implementation (`RestGoogleSttTransport`) batches chunks and uses
 *      the REST `speech:recognize` endpoint with `enableAutomaticPunctuation`
 *      and `alternativeLanguageCodes`. This satisfies Story 2.2's
 *      acceptance criteria (language-hint plumbing + `alternativeLanguageCodes`)
 *      without taking on a native gRPC dependency.
 *
 *      A second transport `StreamingGoogleSttTransport` will be wired to
 *      a native gRPC bridge in a future native-modules sprint (see
 *      roadmap §4 Story 2.2b). Both transports satisfy the same TS
 *      interface so the adapter is unchanged.
 *
 * Auto language detection (Story 2.4) is handled at the transport level
 * by passing `alternativeLanguageCodes` and reading `languageCode` from
 * the first response. Google supports up to four alternates; we cap at
 * three plus the primary.
 */

import type { AudioChunk } from '../audio/audio-types';
import type { LangCode } from '../audio/audio-session-types';
import type {
  SttEvent,
  SttEventListener,
  SttErrorCode,
  SttProvider,
  SttSession,
  SttStartOptions,
} from './stt-types';

/**
 * The audio format we always emit. Google's REST API accepts base64-encoded
 * little-endian 16-bit PCM at any sample rate up to 48 kHz; ours is fixed
 * at 16 kHz mono per `audio-types.ts`.
 */
export const GOOGLE_STT_ENCODING = 'LINEAR16' as const;
export const GOOGLE_STT_SAMPLE_RATE = 16_000 as const;

export interface GoogleSttRecognizeRequest {
  config: {
    encoding: typeof GOOGLE_STT_ENCODING;
    sampleRateHertz: typeof GOOGLE_STT_SAMPLE_RATE;
    languageCode: LangCode;
    alternativeLanguageCodes?: LangCode[];
    enableAutomaticPunctuation: boolean;
    profanityFilter: boolean;
    /**
     * Google STT supports `model: "latest_long"` for >1-min audio and
     * `latest_short` for <=1-min. Lecture mode (FR-2) uses long; conversation
     * uses short. The provider sets this from `mode`.
     */
    model: 'latest_short' | 'latest_long';
    /** Hint that we'll send chunks; the REST transport ignores this. */
    interimResults: boolean;
  };
  audio: { content: string }; // base64 little-endian int16 PCM
}

export interface GoogleSttResultAlternative {
  transcript: string;
  confidence?: number;
}

export interface GoogleSttResult {
  alternatives: GoogleSttResultAlternative[];
  isFinal: boolean;
  /** `LANGUAGE_CODE` if Google detected one of the alternatives; absent otherwise. */
  languageCode?: LangCode;
  /** Confidence ∈ [0,1]; only present when `languageCode` is. */
  languageConfidence?: number;
}

/**
 * A transport handles the actual wire-level communication with Google.
 *
 *  - `recognize(req)` returns the next result(s) for the buffered audio.
 *  - The provider calls `recognize` once per finalised chunk (REST mode);
 *    a future streaming transport could keep an open gRPC stream and
 *    yield results asynchronously via `onResult`.
 */
export interface GoogleSttTransport {
  /**
   * Submit a recognition request. Returns the parsed result(s) for the
   * audio. May return zero results if Google found no speech.
   */
  recognize(req: GoogleSttRecognizeRequest): Promise<GoogleSttResult[]>;
}

/**
 * REST transport. Uses an injected `fetch`-shaped function so tests can
 * stub it without hitting the network.
 */
export interface RestGoogleSttTransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export class RestGoogleSttTransport implements GoogleSttTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(opts: RestGoogleSttTransportOptions) {
    if (!opts.apiKey) {
      throw new Error('RestGoogleSttTransport: apiKey is required.');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://speech.googleapis.com/v1/speech:recognize';
    if (opts.fetcher !== undefined) {
      this.fetcher = opts.fetcher;
    } else {
      if (typeof fetch === 'undefined') {
        throw new Error(
          'No global fetch available. Pass `fetcher` to RestGoogleSttTransport when running in a non-browser/non-RN environment.',
        );
      }
      this.fetcher = fetch;
    }
  }

  async recognize(req: GoogleSttRecognizeRequest): Promise<GoogleSttResult[]> {
    const url = `${this.baseUrl}?key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await safeReadText(res);
      throw new GoogleSttHttpError(res.status, text);
    }
    const json = (await res.json()) as {
      results?: Array<{
        alternatives?: Array<{ transcript?: string; confidence?: number }>;
        languageCode?: string;
        languageConfidence?: number;
      }>;
    };
    const results: GoogleSttResult[] = [];
    for (const r of json.results ?? []) {
      const alternatives: GoogleSttResultAlternative[] = [];
      for (const a of r.alternatives ?? []) {
        if (a.transcript === undefined) continue;
        const alt: GoogleSttResultAlternative =
          a.confidence === undefined
            ? { transcript: a.transcript }
            : { transcript: a.transcript, confidence: a.confidence };
        alternatives.push(alt);
      }
      if (alternatives.length === 0) continue;
      // Synchronous REST recognize always returns finalised results.
      const result: GoogleSttResult = {
        alternatives,
        isFinal: true,
        ...(r.languageCode !== undefined ? { languageCode: r.languageCode } : {}),
        ...(r.languageConfidence !== undefined ? { languageConfidence: r.languageConfidence } : {}),
      };
      results.push(result);
    }
    return results;
  }
}

export class GoogleSttHttpError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Google STT request failed: ${status} ${body}`);
    this.status = status;
    this.name = 'GoogleSttHttpError';
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable response body>';
  }
}

/**
 * Provider mode. `conversation` → `latest_short`; `lecture` → `latest_long`.
 * Defaults to `conversation`.
 */
export type GoogleSttMode = 'conversation' | 'lecture';

export interface GoogleSttProviderOptions {
  transport: GoogleSttTransport;
  mode?: GoogleSttMode;
  /**
   * Up to three alternate languages for auto-detect (Story 2.4).
   * Google caps at four total (primary + 3 alternates).
   */
  alternativeLanguageCodes?: LangCode[];
}

export class GoogleSttProvider implements SttProvider {
  readonly engine = 'google' as const;

  private readonly transport: GoogleSttTransport;
  private readonly mode: GoogleSttMode;
  private readonly alternates: LangCode[];

  constructor(opts: GoogleSttProviderOptions) {
    this.transport = opts.transport;
    this.mode = opts.mode ?? 'conversation';
    this.alternates = (opts.alternativeLanguageCodes ?? []).slice(0, 3);
  }

  async start(opts: SttStartOptions): Promise<SttSession> {
    const session = new GoogleSttRestSession(this.transport, opts, {
      mode: this.mode,
      alternates: this.alternates,
    });
    if (opts.signal !== undefined) {
      const onAbort = (): void => {
        session.cancel('Aborted by caller.');
      };
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    // No async handshake; resolve synchronously so callers can immediately
    // start sending chunks.
    return Promise.resolve(session);
  }
}

interface GoogleSttSessionConfig {
  mode: GoogleSttMode;
  alternates: LangCode[];
}

/**
 * REST-mode session. Each `send(chunk)` call submits a synchronous
 * recognise request; `final` results from those requests are emitted
 * as `final` SttEvents (no partial events in REST mode).
 *
 * The streaming variant (gRPC) will subclass / replace this with a
 * persistent stream that yields `partial` and `final` results as they
 * arrive from Google.
 */
class GoogleSttRestSession implements SttSession {
  readonly engine = 'google' as const;

  private readonly transport: GoogleSttTransport;
  private readonly opts: SttStartOptions;
  private readonly cfg: GoogleSttSessionConfig;
  private readonly listeners = new Set<SttEventListener>();
  private cancelled = false;
  private ended = false;
  private closed = false;
  private readonly pending: Array<Promise<void>> = [];
  private detectedLang: LangCode | undefined;

  constructor(transport: GoogleSttTransport, opts: SttStartOptions, cfg: GoogleSttSessionConfig) {
    this.transport = transport;
    this.opts = opts;
    this.cfg = cfg;
  }

  on(listener: SttEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(chunk: AudioChunk): void {
    if (this.ended || this.closed) {
      throw new Error('GoogleSttRestSession: send() after end() / closed.');
    }
    if (this.cancelled) return;
    const req: GoogleSttRecognizeRequest = {
      config: {
        encoding: GOOGLE_STT_ENCODING,
        sampleRateHertz: GOOGLE_STT_SAMPLE_RATE,
        languageCode: this.opts.lang,
        ...(this.opts.autoLanguageDetect === true && this.cfg.alternates.length > 0
          ? { alternativeLanguageCodes: this.cfg.alternates }
          : {}),
        enableAutomaticPunctuation: true,
        profanityFilter: false,
        model: this.cfg.mode === 'lecture' ? 'latest_long' : 'latest_short',
        interimResults: this.opts.interimResults !== false,
      },
      audio: { content: int16ToBase64(chunk.samples) },
    };
    const p = this.transport
      .recognize(req)
      .then((results) => this.handleResults(results))
      .catch((err: unknown) => this.handleTransportError(err));
    this.pending.push(p);
  }

  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    // Wait for all in-flight recognize calls to complete before closing.
    await Promise.allSettled(this.pending);
    if (!this.closed) {
      this.closed = true;
      this.emit({ type: 'closed' });
    }
  }

  cancel(reason: string): void {
    if (this.closed) return;
    this.cancelled = true;
    this.emit({ type: 'error', code: 'cancelled', message: reason });
    this.closed = true;
    this.emit({ type: 'closed' });
  }

  private handleResults(results: GoogleSttResult[]): void {
    if (this.closed || this.cancelled) return;
    for (const r of results) {
      if (r.languageCode !== undefined && r.languageCode !== this.detectedLang) {
        this.detectedLang = r.languageCode;
        if (this.opts.autoLanguageDetect === true) {
          this.emit({
            type: 'language-detected',
            lang: r.languageCode,
            confidence: r.languageConfidence ?? 0,
          });
        }
      }
      const alt = r.alternatives[0];
      if (alt === undefined) continue;
      const lang = r.languageCode ?? this.opts.lang;
      const event: SttEvent = r.isFinal
        ? {
            type: 'final',
            transcript: alt.transcript,
            ...(alt.confidence !== undefined ? { confidence: alt.confidence } : {}),
            lang,
          }
        : {
            type: 'partial',
            transcript: alt.transcript,
            ...(alt.confidence !== undefined ? { confidence: alt.confidence } : {}),
            lang,
          };
      this.emit(event);
    }
  }

  private handleTransportError(err: unknown): void {
    if (this.closed || this.cancelled) return;
    const code = mapGoogleError(err);
    const message = err instanceof Error ? err.message : String(err);
    this.emit({ type: 'error', code, message });
  }

  private emit(ev: SttEvent): void {
    for (const l of this.listeners) {
      l(ev);
    }
  }
}

function mapGoogleError(err: unknown): SttErrorCode {
  if (err instanceof GoogleSttHttpError) {
    if (err.status === 401 || err.status === 403) return 'auth';
    if (err.status === 429) return 'rate-limited';
    if (err.status === 400) return 'invalid-audio';
    if (err.status >= 500) return 'engine';
    return 'engine';
  }
  // TypeError from `fetch` indicates a network failure in most runtimes.
  if (err instanceof TypeError) return 'network';
  return 'unknown';
}

/**
 * Encode an int16 PCM frame to a base64 string. The byte order is
 * little-endian to match `LINEAR16` per Google's docs.
 */
export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    bytes[i * 2] = s & 0xff;
    bytes[i * 2 + 1] = (s >> 8) & 0xff;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser / RN fallback.
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] ?? 0);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b64Fn = (globalThis as any).btoa as ((s: string) => string) | undefined;
  if (b64Fn === undefined) {
    throw new Error('No base64 encoder available (Buffer or btoa).');
  }
  return b64Fn(bin);
}
