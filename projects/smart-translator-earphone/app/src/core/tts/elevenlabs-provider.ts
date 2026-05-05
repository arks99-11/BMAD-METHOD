/**
 * Story 4.1 — ElevenLabs adapter.
 *
 * Implements `TtsProvider` over `/v1/text-to-speech/{voice_id}/stream`.
 *
 * Key choices:
 *  - Default model: `eleven_multilingual_v2` — picks language from text;
 *    the `language` field of `TtsRequest` is recorded on the result but
 *    isn't sent to the API. Override via constructor opts.
 *  - Default output: `pcm_24000` (PCM int16 little-endian @ 24 kHz mono)
 *    so the playback path can ingest with at most a single resample.
 *  - `voice_settings.stability` / `similarity_boost` are exposed via
 *    the constructor; rate/pitch from `TtsRequest` are NOT honoured by
 *    ElevenLabs natively — we record them on the result so the
 *    playback layer can rate-shift via SoundTouch (Story 4.5).
 *  - HTTP error mapping mirrors the rest of the codebase.
 */

import {
  abortablePromise,
  readStreamWithCallback,
  wrapAsTtsStream,
} from './base-tts-provider';
import {
  TtsError,
  type TtsAudioFormat,
  type TtsProvider,
  type TtsRequest,
  type TtsResult,
  type TtsStream,
  type TtsStreamListener,
} from './tts-types';

export interface ElevenLabsProviderOptions {
  apiKey: string;
  /** Defaults to `https://api.elevenlabs.io/v1/text-to-speech`. */
  baseUrl?: string;
  /** Defaults to `eleven_multilingual_v2`. */
  modelId?: string;
  /** 0–1; ElevenLabs default is 0.5. */
  stability?: number;
  /** 0–1; ElevenLabs default is 0.75. */
  similarityBoost?: number;
  /**
   * 0–1. Style bias — high values lean into the voice's characteristic
   * delivery; low values stay neutral. ElevenLabs default is 0.
   */
  style?: number;
  /** Defaults to `pcm-s16le-24k`. */
  defaultFormat?: TtsAudioFormat;
  fetcher?: typeof fetch;
}

export class ElevenLabsProvider implements TtsProvider {
  readonly engine = 'elevenlabs' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelId: string;
  private readonly stability: number;
  private readonly similarityBoost: number;
  private readonly style: number;
  private readonly defaultFormat: TtsAudioFormat;
  private readonly fetcher: typeof fetch;

  constructor(opts: ElevenLabsProviderOptions) {
    if (!opts.apiKey) {
      throw new Error('ElevenLabsProvider: apiKey is required.');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.elevenlabs.io/v1/text-to-speech';
    this.modelId = opts.modelId ?? 'eleven_multilingual_v2';
    this.stability = opts.stability ?? 0.5;
    this.similarityBoost = opts.similarityBoost ?? 0.75;
    this.style = opts.style ?? 0;
    this.defaultFormat = opts.defaultFormat ?? 'pcm-s16le-24k';
    if (opts.fetcher !== undefined) {
      this.fetcher = opts.fetcher;
    } else if (typeof fetch !== 'undefined') {
      this.fetcher = fetch;
    } else {
      throw new Error(
        'ElevenLabsProvider: no global fetch available. Pass `fetcher` in non-browser/non-RN environments.',
      );
    }
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const stream = this.synthesizeStream(req);
    return stream.done;
  }

  synthesizeStream(req: TtsRequest): TtsStream {
    const format = req.format ?? this.defaultFormat;
    const queryFmt = toElevenLabsFormat(format);
    if (queryFmt === null) {
      const err = new TtsError(
        'engine',
        this.engine,
        `ElevenLabs does not support format ${format}. Use 'pcm-s16le-24k' or 'mp3-44k'.`,
      );
      return wrapAsTtsStream(this.engine, Promise.reject(err));
    }
    return this.streamSynthesis(req, format, queryFmt);
  }

  private streamSynthesis(
    req: TtsRequest,
    format: TtsAudioFormat,
    queryFmt: string,
  ): TtsStream {
    const listeners = new Set<TtsStreamListener>();
    const start = Date.now();
    let terminal: 'final' | 'error' | null = null;

    const emit = (ev: import('./tts-types').TtsStreamEvent): void => {
      if (terminal !== null) return;
      if (ev.type === 'final' || ev.type === 'error') terminal = ev.type;
      for (const l of listeners) l(ev);
    };

    const done = (async (): Promise<TtsResult> => {
      const url = `${this.baseUrl}/${encodeURIComponent(req.voice)}/stream?output_format=${queryFmt}`;
      const headers: Record<string, string> = {
        'xi-api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'audio/*',
      };
      const body = JSON.stringify({
        text: req.text,
        model_id: this.modelId,
        voice_settings: {
          stability: this.stability,
          similarity_boost: this.similarityBoost,
          style: this.style,
        },
      });
      const init: RequestInit = {
        method: 'POST',
        headers,
        body,
        ...(req.signal !== undefined ? { signal: req.signal } : {}),
      };
      let res: Response;
      try {
        const aborted = abortablePromise(req.signal, this.engine);
        res = await Promise.race([this.fetcher(url, init), aborted]);
      } catch (err) {
        const wrapped = wrapTransportError(err, this.engine);
        emit({ type: 'error', error: wrapped });
        throw wrapped;
      }
      if (!res.ok) {
        const txt = await safeText(res);
        const wrapped = mapElevenLabsHttp(res.status, txt);
        emit({ type: 'error', error: wrapped });
        throw wrapped;
      }
      if (res.body === null || res.body === undefined) {
        const wrapped = new TtsError('engine', this.engine, 'ElevenLabs returned no audio body.');
        emit({ type: 'error', error: wrapped });
        throw wrapped;
      }
      let audio: Uint8Array;
      try {
        audio = await readStreamWithCallback(
          res.body,
          (chunk) => emit({ type: 'chunk', audio: chunk, format }),
          req.signal,
        );
      } catch (err) {
        const wrapped =
          err instanceof Error && err.message === 'aborted'
            ? new TtsError('cancelled', this.engine, 'aborted')
            : wrapTransportError(err, this.engine);
        emit({ type: 'error', error: wrapped });
        throw wrapped;
      }
      const result: TtsResult = {
        audio,
        format,
        engine: this.engine,
        voice: req.voice,
        durationMs: Date.now() - start,
      };
      emit({ type: 'final', result });
      return result;
    })();
    // Suppress unhandled rejection.
    done.catch(() => undefined);

    return {
      engine: this.engine,
      on(listener: TtsStreamListener): () => void {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      done,
    };
  }
}

function toElevenLabsFormat(fmt: TtsAudioFormat): string | null {
  switch (fmt) {
    case 'pcm-s16le-24k':
      return 'pcm_24000';
    case 'pcm-s16le-16k':
      return 'pcm_16000';
    case 'mp3-44k':
      return 'mp3_44100_128';
    default:
      return null;
  }
}

function mapElevenLabsHttp(status: number, body: string): TtsError {
  if (status === 401 || status === 403) {
    return new TtsError('auth', 'elevenlabs', body || `auth failed (${status})`, status);
  }
  if (status === 429) {
    return new TtsError('rate-limited', 'elevenlabs', body || 'rate-limited', status);
  }
  if (status === 422) {
    // ElevenLabs returns 422 for "voice not found" and "invalid text".
    if (/voice/i.test(body)) {
      return new TtsError('unsupported-voice', 'elevenlabs', body, status);
    }
    return new TtsError('invalid-input', 'elevenlabs', body, status);
  }
  if (status >= 500) {
    return new TtsError('engine', 'elevenlabs', body || 'server error', status);
  }
  return new TtsError('engine', 'elevenlabs', body || `HTTP ${status}`, status);
}

function wrapTransportError(err: unknown, engine: 'elevenlabs'): TtsError {
  if (err instanceof TtsError) return err;
  if (err instanceof TypeError) return new TtsError('network', engine, err.message);
  return new TtsError('unknown', engine, err instanceof Error ? err.message : String(err));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
