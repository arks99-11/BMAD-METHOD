/**
 * Story 4.2 — Azure Cognitive Services TTS adapter.
 *
 * POSTs SSML to `/cognitiveservices/v1` and streams back PCM (or
 * Opus / MP3 depending on the requested format). Authenticated via
 * the subscription key in `Ocp-Apim-Subscription-Key`. The subscription
 * key is paired with a region (`westus2`, `eastus`, …) which forms the
 * hostname.
 *
 * Azure supports rate / pitch via SSML `<prosody rate=… pitch=…>`. We
 * apply them via the SSML builder so the playback layer doesn't need
 * to do any post-processing.
 *
 * Voice naming: Azure neural voices use the format
 * `{lang-region}-{name}Neural` (e.g. `en-US-JennyNeural`). The voice
 * catalog (Story 4.4) maps the user's selection to this format. The
 * adapter does not validate the voice name itself; Azure returns 400
 * for unknown names which we map to `unsupported-voice`.
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

export interface AzureTtsProviderOptions {
  /** Azure speech resource subscription key. */
  subscriptionKey: string;
  /**
   * Azure region slug, e.g. `eastus`, `westus2`, `southeastasia`.
   * Used to build the request URL.
   */
  region: string;
  /** Override for non-default endpoint shapes (sovereign clouds, mocks). */
  baseUrl?: string;
  /** Default `pcm-s16le-24k`. */
  defaultFormat?: TtsAudioFormat;
  fetcher?: typeof fetch;
}

export class AzureTtsProvider implements TtsProvider {
  readonly engine = 'azure' as const;

  private readonly subscriptionKey: string;
  private readonly baseUrl: string;
  private readonly defaultFormat: TtsAudioFormat;
  private readonly fetcher: typeof fetch;

  constructor(opts: AzureTtsProviderOptions) {
    if (!opts.subscriptionKey) {
      throw new Error('AzureTtsProvider: subscriptionKey is required.');
    }
    if (!opts.region && !opts.baseUrl) {
      throw new Error('AzureTtsProvider: region (or explicit baseUrl) is required.');
    }
    this.subscriptionKey = opts.subscriptionKey;
    this.baseUrl =
      opts.baseUrl ?? `https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    this.defaultFormat = opts.defaultFormat ?? 'pcm-s16le-24k';
    if (opts.fetcher !== undefined) {
      this.fetcher = opts.fetcher;
    } else if (typeof fetch !== 'undefined') {
      this.fetcher = fetch;
    } else {
      throw new Error(
        'AzureTtsProvider: no global fetch available. Pass `fetcher` in non-browser/non-RN environments.',
      );
    }
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    return this.synthesizeStream(req).done;
  }

  synthesizeStream(req: TtsRequest): TtsStream {
    const format = req.format ?? this.defaultFormat;
    const azureFmt = toAzureOutputFormat(format);
    if (azureFmt === null) {
      return wrapAsTtsStream(
        this.engine,
        Promise.reject(
          new TtsError(
            'engine',
            this.engine,
            `Azure TTS does not support format ${format}.`,
          ),
        ),
      );
    }
    return this.streamSynthesis(req, format, azureFmt);
  }

  private streamSynthesis(
    req: TtsRequest,
    format: TtsAudioFormat,
    azureFmt: string,
  ): TtsStream {
    const listeners = new Set<TtsStreamListener>();
    const start = Date.now();
    let terminal: 'final' | 'error' | null = null;

    const emit = (ev: import('./tts-types').TtsStreamEvent): void => {
      if (terminal !== null) return;
      if (ev.type === 'final' || ev.type === 'error') terminal = ev.type;
      for (const l of listeners) l(ev);
    };

    const ssml = buildSsml(req);
    const headers: Record<string, string> = {
      'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': azureFmt,
      'User-Agent': 'smart-translator-earphone/1.0',
    };
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: ssml,
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    };

    const done = (async (): Promise<TtsResult> => {
      let res: Response;
      try {
        const aborted = abortablePromise(req.signal, this.engine);
        res = await Promise.race([this.fetcher(this.baseUrl, init), aborted]);
      } catch (err) {
        const wrapped = wrapTransportError(err, this.engine);
        emit({ type: 'error', error: wrapped });
        throw wrapped;
      }
      if (!res.ok) {
        const txt = await safeText(res);
        const wrapped = mapAzureHttp(res.status, txt);
        emit({ type: 'error', error: wrapped });
        throw wrapped;
      }
      if (res.body === null || res.body === undefined) {
        const wrapped = new TtsError('engine', this.engine, 'Azure returned no audio body.');
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

export function buildSsml(req: TtsRequest): string {
  const ratePct = req.rate !== undefined ? rateToPercent(req.rate) : null;
  const pitchSt = req.pitch !== undefined ? `${req.pitch}st` : null;
  const inner = req.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wrapped =
    ratePct !== null || pitchSt !== null
      ? `<prosody${ratePct !== null ? ` rate="${ratePct}"` : ''}${
          pitchSt !== null ? ` pitch="${pitchSt}"` : ''
        }>${inner}</prosody>`
      : inner;
  return [
    `<speak version="1.0" xml:lang="${req.language}">`,
    `<voice xml:lang="${req.language}" name="${req.voice}">`,
    wrapped,
    '</voice>',
    '</speak>',
  ].join('');
}

function rateToPercent(rate: number): string {
  // 1.0 → "0%"; 1.5 → "+50%"; 0.8 → "-20%". Clamp to ±100%.
  const pct = Math.max(-100, Math.min(100, Math.round((rate - 1) * 100)));
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function toAzureOutputFormat(fmt: TtsAudioFormat): string | null {
  switch (fmt) {
    case 'pcm-s16le-16k':
      return 'raw-16khz-16bit-mono-pcm';
    case 'pcm-s16le-24k':
      return 'raw-24khz-16bit-mono-pcm';
    case 'mp3-44k':
      return 'audio-44khz-128kbitrate-mono-mp3';
    case 'opus-48k':
      return 'ogg-48khz-16bit-mono-opus';
    default:
      return null;
  }
}

function mapAzureHttp(status: number, body: string): TtsError {
  if (status === 401 || status === 403) {
    return new TtsError('auth', 'azure', body || `auth failed (${status})`, status);
  }
  if (status === 429) {
    return new TtsError('rate-limited', 'azure', body || 'rate-limited', status);
  }
  if (status === 400) {
    if (/voice/i.test(body)) {
      return new TtsError('unsupported-voice', 'azure', body, status);
    }
    return new TtsError('invalid-input', 'azure', body, status);
  }
  if (status >= 500) {
    return new TtsError('engine', 'azure', body || 'server error', status);
  }
  return new TtsError('engine', 'azure', body || `HTTP ${status}`, status);
}

function wrapTransportError(err: unknown, engine: 'azure'): TtsError {
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
