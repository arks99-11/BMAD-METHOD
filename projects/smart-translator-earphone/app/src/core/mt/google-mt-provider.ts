/**
 * Story 3.2 — Google Cloud Translation adapter.
 *
 * Implements `MtProvider` using Google's `translate.googleapis.com/v3`
 * endpoint. The v3 API is project-scoped (requires a GCP project ID
 * and authenticated bearer token), but for cost / setup parity with
 * the Google STT adapter we use the simpler v2 `language/translate/v2`
 * endpoint authenticated via API key. The v3 transport will subclass
 * `GoogleMtTransport` once Story 3.6 (managed glossaries) lands.
 *
 *  - Source language `'auto'` → omit the `source` parameter so Google
 *    detects the language and returns it in `data.translations[0]
 *    .detectedSourceLanguage`.
 *
 *  - Target accepts BCP-47 lower-cased codes (`en-US`, `vi`, `zh-CN`).
 *    We pass through the request's `target` unchanged.
 */

import { abortablePromise, wrapAsStream } from './base-mt-provider';
import {
  MtError,
  type MtProvider,
  type MtRequest,
  type MtResult,
  type MtStream,
} from './mt-types';

export interface GoogleMtTransport {
  translate(req: GoogleTranslateRequest): Promise<GoogleTranslateResult>;
}

export interface GoogleTranslateRequest {
  q: string;
  source?: string;
  target: string;
  format?: 'text' | 'html';
  signal?: AbortSignal;
}

export interface GoogleTranslateResult {
  translatedText: string;
  detectedSourceLanguage?: string;
}

export interface GoogleMtRestTransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

interface GoogleV2Response {
  data?: {
    translations?: Array<{
      translatedText?: string;
      detectedSourceLanguage?: string;
    }>;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export class GoogleMtRestTransport implements GoogleMtTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(opts: GoogleMtRestTransportOptions) {
    if (!opts.apiKey) {
      throw new Error('GoogleMtRestTransport: apiKey is required.');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://translation.googleapis.com/language/translate/v2';
    if (opts.fetcher !== undefined) {
      this.fetcher = opts.fetcher;
    } else if (typeof fetch !== 'undefined') {
      this.fetcher = fetch;
    } else {
      throw new Error(
        'GoogleMtRestTransport: no global fetch available. Pass `fetcher` in non-browser/non-RN environments.',
      );
    }
  }

  async translate(req: GoogleTranslateRequest): Promise<GoogleTranslateResult> {
    const url = `${this.baseUrl}?key=${encodeURIComponent(this.apiKey)}`;
    const body = JSON.stringify({
      q: req.q,
      target: req.target,
      ...(req.source !== undefined ? { source: req.source } : {}),
      format: req.format ?? 'text',
    });
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    };
    const res = await this.fetcher(url, init);
    if (!res.ok) {
      const text = await safeText(res);
      throw new GoogleMtHttpError(res.status, text);
    }
    const json = (await res.json()) as GoogleV2Response;
    const t = json.data?.translations?.[0];
    if (t === undefined || t.translatedText === undefined) {
      const errMessage = json.error?.message ?? 'Google Translate returned no translations.';
      throw new GoogleMtHttpError(res.status, errMessage);
    }
    return {
      translatedText: t.translatedText,
      ...(t.detectedSourceLanguage !== undefined
        ? { detectedSourceLanguage: t.detectedSourceLanguage }
        : {}),
    };
  }
}

export class GoogleMtHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Google MT request failed: ${status} ${body}`);
    this.status = status;
    this.body = body;
    this.name = 'GoogleMtHttpError';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export interface GoogleMtProviderOptions {
  transport: GoogleMtTransport;
}

export class GoogleMtProvider implements MtProvider {
  readonly engine = 'google' as const;
  private readonly transport: GoogleMtTransport;

  constructor(opts: GoogleMtProviderOptions) {
    this.transport = opts.transport;
  }

  async translate(req: MtRequest): Promise<MtResult> {
    const start = Date.now();
    const transportReq: GoogleTranslateRequest = {
      q: req.text,
      target: req.target,
      ...(req.source !== 'auto' ? { source: req.source } : {}),
      format: 'text',
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    };
    let result: GoogleTranslateResult;
    try {
      const aborted = abortablePromise(req.signal, this.engine);
      result = await Promise.race([this.transport.translate(transportReq), aborted]);
    } catch (err) {
      if (err instanceof MtError) throw err;
      if (err instanceof GoogleMtHttpError) {
        throw mapGoogleError(err);
      }
      if (err instanceof TypeError) {
        throw new MtError('network', this.engine, err.message);
      }
      throw new MtError('unknown', this.engine, err instanceof Error ? err.message : String(err));
    }
    return {
      text: result.translatedText,
      ...(result.detectedSourceLanguage !== undefined
        ? { detectedSource: result.detectedSourceLanguage }
        : {}),
      engine: this.engine,
      durationMs: Date.now() - start,
    };
  }

  translateStream(req: MtRequest): MtStream {
    return wrapAsStream(this.engine, this.translate(req));
  }
}

function mapGoogleError(err: GoogleMtHttpError): MtError {
  if (err.status === 401 || err.status === 403) {
    return new MtError('auth', 'google', err.body || 'Google MT auth failed.', err.status);
  }
  if (err.status === 429) {
    return new MtError('rate-limited', 'google', err.body || 'Google MT rate-limited.', err.status);
  }
  if (err.status === 400) {
    return new MtError(
      'invalid-input',
      'google',
      err.body || 'Google MT rejected the request.',
      err.status,
    );
  }
  if (err.status >= 500) {
    return new MtError('engine', 'google', err.body || 'Google MT server error.', err.status);
  }
  return new MtError('engine', 'google', err.body || `Google MT HTTP ${err.status}.`, err.status);
}
