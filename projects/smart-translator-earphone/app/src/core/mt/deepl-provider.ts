/**
 * Story 3.1 — DeepL adapter.
 *
 * Implements `MtProvider` using DeepL's REST `/v2/translate` endpoint.
 *
 * Design notes:
 *
 *  - DeepL accepts source/target as ISO 639-1 codes (`EN`, `DE`, …) or
 *    BCP-47 with region (`EN-US`, `PT-BR`). We pass the BCP-47 string
 *    through and let DeepL's normaliser handle it.
 *
 *  - DeepL's `formality` parameter is plumbed when present in the
 *    request. For pairs that don't support formality, DeepL returns a
 *    400; we map it to `unsupported-pair`.
 *
 *  - Glossary entries are forwarded as DeepL's inline glossary feature
 *    (the request payload's `glossary_id` field requires a pre-uploaded
 *    glossary; we don't upload glossaries from the client, so we add
 *    them as preserved text via `<x>` tags + `tag_handling=xml`). This
 *    is a v1 simplification — Story 3.6 will move to managed glossaries.
 *
 *  - Both the free (`api-free.deepl.com`) and paid (`api.deepl.com`)
 *    base URLs are supported via `baseUrl`.
 */

import { abortablePromise, wrapAsStream } from './base-mt-provider';
import {
  MtError,
  type MtProvider,
  type MtRequest,
  type MtResult,
  type MtStream,
} from './mt-types';

export interface DeeplProviderOptions {
  /** DeepL API token. Pulled from secure storage at session start. */
  apiToken: string;
  /**
   * `https://api.deepl.com/v2/translate` for paid plans;
   * `https://api-free.deepl.com/v2/translate` for free plan. Defaults
   * to the free endpoint because that is what new accounts receive.
   */
  baseUrl?: string;
  fetcher?: typeof fetch;
}

interface DeeplResponse {
  translations: Array<{
    detected_source_language?: string;
    text: string;
  }>;
}

export class DeeplProvider implements MtProvider {
  readonly engine = 'deepl' as const;

  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(opts: DeeplProviderOptions) {
    if (!opts.apiToken) {
      throw new Error('DeeplProvider: apiToken is required.');
    }
    this.apiToken = opts.apiToken;
    this.baseUrl = opts.baseUrl ?? 'https://api-free.deepl.com/v2/translate';
    if (opts.fetcher !== undefined) {
      this.fetcher = opts.fetcher;
    } else if (typeof fetch !== 'undefined') {
      this.fetcher = fetch;
    } else {
      throw new Error(
        'DeeplProvider: no global fetch available. Pass `fetcher` in non-browser/non-RN environments.',
      );
    }
  }

  async translate(req: MtRequest): Promise<MtResult> {
    const start = performanceNow();
    const body = buildBody(req);
    const headers: Record<string, string> = {
      authorization: `DeepL-Auth-Key ${this.apiToken}`,
      'content-type': 'application/x-www-form-urlencoded',
    };
    let res: Response;
    try {
      const fetchPromise = this.fetcher(this.baseUrl, {
        method: 'POST',
        headers,
        body,
      });
      const aborted = abortablePromise(req.signal, this.engine);
      res = await Promise.race([fetchPromise, aborted]);
    } catch (err) {
      if (err instanceof MtError) throw err;
      if (err instanceof TypeError) {
        throw new MtError('network', this.engine, errMsg(err));
      }
      throw new MtError('unknown', this.engine, errMsg(err));
    }
    if (!res.ok) {
      throw mapDeeplError(res.status, await safeReadText(res));
    }
    let parsed: DeeplResponse;
    try {
      parsed = (await res.json()) as DeeplResponse;
    } catch (err) {
      throw new MtError('engine', this.engine, `DeepL returned malformed JSON: ${errMsg(err)}`);
    }
    const t = parsed.translations[0];
    if (t === undefined) {
      throw new MtError('engine', this.engine, 'DeepL returned no translations.');
    }
    return {
      text: unwrapGlossary(t.text, req.glossary),
      ...(t.detected_source_language !== undefined
        ? { detectedSource: t.detected_source_language }
        : {}),
      engine: this.engine,
      durationMs: performanceNow() - start,
    };
  }

  translateStream(req: MtRequest): MtStream {
    return wrapAsStream(this.engine, this.translate(req));
  }
}

function buildBody(req: MtRequest): string {
  const params = new URLSearchParams();
  params.set('text', wrapGlossary(req.text, req.glossary));
  params.set('target_lang', toDeeplLang(req.target));
  if (req.source !== 'auto') {
    params.set('source_lang', toDeeplLang(req.source));
  }
  if (req.formality !== undefined && req.formality !== 'default') {
    params.set('formality', req.formality);
  }
  if (req.glossary !== undefined && req.glossary.size > 0) {
    params.set('tag_handling', 'xml');
    params.set('ignore_tags', 'x');
  }
  return params.toString();
}

/**
 * DeepL accepts language codes in upper-case (`EN`, `EN-US`, `PT-BR`).
 * BCP-47 lower-cased input is normalised here.
 */
function toDeeplLang(lang: string): string {
  return lang.toUpperCase();
}

/**
 * Wrap glossary terms in `<x id="N">` tags so DeepL preserves them
 * verbatim. The unwrap step on the response removes the tags.
 *
 * This is a v1 simplification — Story 3.6 will move to managed
 * glossaries (DeepL's `/glossaries` endpoint) which are quality-better
 * but require server-side management.
 */
function wrapGlossary(text: string, glossary: ReadonlyMap<string, string> | undefined): string {
  if (glossary === undefined || glossary.size === 0) return text;
  let out = text;
  let id = 0;
  for (const [from, to] of glossary) {
    // Wrap the source term so DeepL doesn't translate it; we'll swap
    // back to the target term after translation.
    out = out.split(from).join(`<x id="${id}">${escapeXml(to)}</x>`);
    id++;
  }
  return out;
}

function unwrapGlossary(text: string, glossary: ReadonlyMap<string, string> | undefined): string {
  if (glossary === undefined || glossary.size === 0) return text;
  // Strip `<x id="N">…</x>` and unescape the content.
  return text.replace(/<x id="\d+">([\s\S]*?)<\/x>/g, (_match, inner: string) =>
    unescapeXml(inner),
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function mapDeeplError(status: number, body: string): MtError {
  if (status === 401 || status === 403) {
    return new MtError('auth', 'deepl', body || `DeepL auth failed (HTTP ${status}).`, status);
  }
  if (status === 429 || status === 456) {
    // 456 = quota exceeded for the period
    return new MtError(
      'rate-limited',
      'deepl',
      body || `DeepL rate-limited (HTTP ${status}).`,
      status,
    );
  }
  if (status === 400) {
    return new MtError(
      'unsupported-pair',
      'deepl',
      body || 'DeepL rejected the language pair.',
      status,
    );
  }
  if (status >= 500) {
    return new MtError('engine', 'deepl', body || `DeepL server error (HTTP ${status}).`, status);
  }
  return new MtError('engine', 'deepl', body || `DeepL HTTP ${status}.`, status);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function performanceNow(): number {
  // Avoid `performance` global in Node test runs; Date.now() is fine
  // for telemetry purposes (millisecond resolution).
  return Date.now();
}
