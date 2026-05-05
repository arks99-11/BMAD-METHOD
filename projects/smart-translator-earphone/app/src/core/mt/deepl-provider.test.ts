/**
 * Story 3.1 — DeepL adapter tests.
 */

import { DeeplProvider } from './deepl-provider';
import { MtError } from './mt-types';
import { FakeFetcher } from '../stt/test-fakes';

describe('Story 3.1 — DeeplProvider', () => {
  test('POSTs to DeepL with the expected form-encoded body and auth header', async () => {
    const fetcher = new FakeFetcher([
      { body: { translations: [{ text: 'Guten Tag', detected_source_language: 'EN' }] } },
    ]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const result = await provider.translate({
      text: 'Good day',
      source: 'EN',
      target: 'DE',
    });
    expect(result.text).toBe('Guten Tag');
    expect(result.detectedSource).toBe('EN');
    expect(result.engine).toBe('deepl');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    const req = fetcher.requests[0]!;
    expect(req.headers['authorization']).toBe('DeepL-Auth-Key TOK');
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(req.body);
    expect(params.get('text')).toBe('Good day');
    expect(params.get('target_lang')).toBe('DE');
    expect(params.get('source_lang')).toBe('EN');
  });

  test('omits source_lang when source is "auto"', async () => {
    const fetcher = new FakeFetcher([
      { body: { translations: [{ text: 'Guten Tag', detected_source_language: 'EN' }] } },
    ]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const result = await provider.translate({ text: 'Good day', source: 'auto', target: 'DE' });
    const params = new URLSearchParams(fetcher.requests[0]!.body);
    expect(params.has('source_lang')).toBe(false);
    expect(result.detectedSource).toBe('EN');
  });

  test('upper-cases BCP-47 lower-case language codes', async () => {
    const fetcher = new FakeFetcher([
      { body: { translations: [{ text: 'Hola', detected_source_language: 'EN' }] } },
    ]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await provider.translate({ text: 'Hi', source: 'en-us', target: 'es' });
    const params = new URLSearchParams(fetcher.requests[0]!.body);
    expect(params.get('source_lang')).toBe('EN-US');
    expect(params.get('target_lang')).toBe('ES');
  });

  test('plumbs formality when not "default"', async () => {
    const fetcher = new FakeFetcher([
      { body: { translations: [{ text: 'Sie sind toll' }] } },
    ]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await provider.translate({
      text: 'You are great',
      source: 'EN',
      target: 'DE',
      formality: 'more',
    });
    const params = new URLSearchParams(fetcher.requests[0]!.body);
    expect(params.get('formality')).toBe('more');
  });

  test('omits formality when explicitly "default"', async () => {
    const fetcher = new FakeFetcher([{ body: { translations: [{ text: 'x' }] } }]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await provider.translate({
      text: 'You are great',
      source: 'EN',
      target: 'DE',
      formality: 'default',
    });
    const params = new URLSearchParams(fetcher.requests[0]!.body);
    expect(params.has('formality')).toBe(false);
  });

  test('preserves glossary terms via XML tag handling', async () => {
    const fetcher = new FakeFetcher([
      { body: { translations: [{ text: 'Mein <x id="0">DeepL</x> ist gut' }] } },
    ]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const glossary = new Map<string, string>([['DeepL', 'DeepL']]);
    const result = await provider.translate({
      text: 'My DeepL is good',
      source: 'EN',
      target: 'DE',
      glossary,
    });
    const params = new URLSearchParams(fetcher.requests[0]!.body);
    expect(params.get('tag_handling')).toBe('xml');
    expect(params.get('ignore_tags')).toBe('x');
    expect(params.get('text')).toContain('<x id="0">DeepL</x>');
    expect(result.text).toBe('Mein DeepL ist gut');
  });

  test('maps HTTP 401 to auth error', async () => {
    const fetcher = new FakeFetcher([{ status: 401, bodyText: 'Forbidden' }]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE' }),
    ).rejects.toMatchObject({ code: 'auth', engine: 'deepl', status: 401 });
  });

  test('maps HTTP 429 to rate-limited', async () => {
    const fetcher = new FakeFetcher([{ status: 429, bodyText: 'slow' }]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
  });

  test('maps HTTP 456 (quota) to rate-limited', async () => {
    const fetcher = new FakeFetcher([{ status: 456, bodyText: 'quota' }]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
  });

  test('maps HTTP 400 to unsupported-pair', async () => {
    const fetcher = new FakeFetcher([{ status: 400, bodyText: 'unsupported' }]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'XX' }),
    ).rejects.toMatchObject({ code: 'unsupported-pair' });
  });

  test('rejects empty apiToken', () => {
    expect(
      () =>
        new DeeplProvider({
          apiToken: '',
          fetcher: new FakeFetcher([]).fetch as unknown as typeof fetch,
        }),
    ).toThrow(/apiToken/);
  });

  test('translateStream emits chunk + final for a successful request', async () => {
    const fetcher = new FakeFetcher([{ body: { translations: [{ text: 'Guten Tag' }] } }]);
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const stream = provider.translateStream({ text: 'Good day', source: 'EN', target: 'DE' });
    const events: string[] = [];
    stream.on((ev) => events.push(ev.type));
    const result = await stream.done;
    expect(events).toEqual(['chunk', 'final']);
    expect(result.text).toBe('Guten Tag');
  });

  test('AbortSignal cancels the translation', async () => {
    const ctrl = new AbortController();
    // Use a fetcher that delays so we can cancel mid-flight.
    const slow = (() =>
      new Promise<unknown>(() => undefined) as unknown as ReturnType<typeof fetch>) as unknown as typeof fetch;
    const provider = new DeeplProvider({
      apiToken: 'TOK',
      fetcher: slow,
    });
    setTimeout(() => ctrl.abort(), 5);
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE', signal: ctrl.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('network failure (TypeError) maps to network code', async () => {
    const failing = (() => {
      throw new TypeError('boom');
    }) as unknown as typeof fetch;
    const provider = new DeeplProvider({ apiToken: 'TOK', fetcher: failing });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE' }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  test('MtError type and class are usable for instanceof checks', () => {
    const e = new MtError('engine', 'deepl', 'whoops');
    expect(e).toBeInstanceOf(MtError);
    expect(e.code).toBe('engine');
    expect(e.engine).toBe('deepl');
  });
});
