/**
 * Free Google Translate provider — uses the public, unofficial endpoint
 * `translate.googleapis.com/translate_a/single` (the same endpoint Chromium's
 * built-in page translator hits).
 *
 *   - **No API key required.** Suitable for demo and local testing.
 *   - **Not for production.** The endpoint is undocumented, rate-limited per
 *     IP, and Google may break or block it at any time. For production, use
 *     `GoogleTranslateProvider` (Cloud Translation v2) with a real key.
 *
 * Response shape (the only stable bits we depend on):
 *
 *     [
 *       [
 *         ["translated chunk 1", "source chunk 1", null, null, …],
 *         ["translated chunk 2", "source chunk 2", null, null, …],
 *         …
 *       ],
 *       null,
 *       "<detected source lang>",   // present when sl=auto
 *       …
 *     ]
 *
 * The translated text is the concatenation of the first element of each
 * chunk row.
 */

import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from './translation-types';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

export interface GoogleTranslateFreeOptions {
  /** Override fetch (used by tests). */
  fetchFn?: typeof fetch;
  /** Override the endpoint base (used by tests / mirrors). */
  endpoint?: string;
}

export class GoogleTranslateFreeProvider implements TranslationProvider {
  readonly id = 'google' as const;

  constructor(private readonly opts: GoogleTranslateFreeOptions = {}) {}

  isAvailable(): boolean {
    return true;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const endpoint = this.opts.endpoint ?? ENDPOINT;
    const params = new URLSearchParams({
      client: 'gtx',
      sl: request.sourceLang === 'auto' ? 'auto' : request.sourceLang,
      tl: request.targetLang,
      dt: 't',
      q: request.text,
    });
    const url = `${endpoint}?${params.toString()}`;
    const res = await fetchFn(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Google Translate (free) HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    return parseResponse(json, request);
  }
}

function parseResponse(raw: unknown, request: TranslationRequest): TranslationResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Google Translate (free) returned an unexpected shape');
  }
  const chunks = raw[0];
  if (!Array.isArray(chunks)) {
    throw new Error('Google Translate (free) returned no translation chunks');
  }
  const translated = chunks
    .map((row) => {
      if (Array.isArray(row) && typeof row[0] === 'string') return row[0];
      return '';
    })
    .join('');
  if (translated.length === 0) {
    throw new Error('Google Translate (free) returned an empty translation');
  }
  const detected = typeof raw[2] === 'string' ? (raw[2] as string) : null;
  const sourceLang =
    detected ??
    (request.sourceLang === 'auto' ? 'auto' : request.sourceLang) ??
    'auto';
  return {
    text: translated,
    sourceLang,
    targetLang: request.targetLang,
    engine: 'google',
  };
}
