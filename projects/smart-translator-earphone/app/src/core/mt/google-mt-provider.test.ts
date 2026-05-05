/**
 * Story 3.2 — Google Cloud Translation adapter tests.
 */

import {
  GoogleMtProvider,
  GoogleMtRestTransport,
} from './google-mt-provider';
import { FakeFetcher } from '../stt/test-fakes';

describe('Story 3.2 — GoogleMtRestTransport', () => {
  test('POSTs to /v2 with API key in query string and JSON body', async () => {
    const fetcher = new FakeFetcher([
      {
        body: {
          data: {
            translations: [{ translatedText: 'Xin chào', detectedSourceLanguage: 'en' }],
          },
        },
      },
    ]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const result = await transport.translate({ q: 'hello', target: 'vi' });
    expect(result.translatedText).toBe('Xin chào');
    expect(result.detectedSourceLanguage).toBe('en');
    expect(fetcher.requests[0]?.url).toContain('?key=KEY');
    expect(fetcher.requests[0]?.headers['content-type']).toBe('application/json');
    const body = JSON.parse(fetcher.requests[0]!.body) as {
      q: string;
      target: string;
      format: string;
    };
    expect(body).toEqual({ q: 'hello', target: 'vi', format: 'text' });
  });

  test('throws GoogleMtHttpError on non-2xx', async () => {
    const fetcher = new FakeFetcher([{ status: 401, bodyText: 'no' }]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(transport.translate({ q: 'hi', target: 'vi' })).rejects.toThrow(/401/);
  });

  test('rejects empty API key', () => {
    expect(
      () =>
        new GoogleMtRestTransport({
          apiKey: '',
          fetcher: new FakeFetcher([]).fetch as unknown as typeof fetch,
        }),
    ).toThrow(/apiKey/);
  });
});

describe('Story 3.2 — GoogleMtProvider', () => {
  test('returns an MtResult with the translated text', async () => {
    const fetcher = new FakeFetcher([
      { body: { data: { translations: [{ translatedText: 'Xin chào' }] } } },
    ]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleMtProvider({ transport });
    const result = await provider.translate({ text: 'hello', source: 'en', target: 'vi' });
    expect(result.text).toBe('Xin chào');
    expect(result.engine).toBe('google');
  });

  test('source "auto" omits source from the request', async () => {
    const fetcher = new FakeFetcher([
      { body: { data: { translations: [{ translatedText: 'Xin chào', detectedSourceLanguage: 'en' }] } } },
    ]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleMtProvider({ transport });
    const result = await provider.translate({ text: 'hello', source: 'auto', target: 'vi' });
    const body = JSON.parse(fetcher.requests[0]!.body) as { source?: string };
    expect(body.source).toBeUndefined();
    expect(result.detectedSource).toBe('en');
  });

  test('HTTP 401 maps to auth MtError', async () => {
    const fetcher = new FakeFetcher([{ status: 401, bodyText: 'no' }]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'en', target: 'vi' }),
    ).rejects.toMatchObject({ code: 'auth', engine: 'google' });
  });

  test('HTTP 429 maps to rate-limited', async () => {
    const fetcher = new FakeFetcher([{ status: 429, bodyText: 'rl' }]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'en', target: 'vi' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
  });

  test('HTTP 400 maps to invalid-input', async () => {
    const fetcher = new FakeFetcher([{ status: 400, bodyText: 'bad' }]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'en', target: 'vi' }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  test('translateStream emits chunk + final', async () => {
    const fetcher = new FakeFetcher([
      { body: { data: { translations: [{ translatedText: 'Xin chào' }] } } },
    ]);
    const transport = new GoogleMtRestTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleMtProvider({ transport });
    const stream = provider.translateStream({ text: 'hello', source: 'en', target: 'vi' });
    const events: string[] = [];
    stream.on((ev) => events.push(ev.type));
    const result = await stream.done;
    expect(events).toEqual(['chunk', 'final']);
    expect(result.text).toBe('Xin chào');
  });

  test('AbortSignal cancels the translation', async () => {
    const ctrl = new AbortController();
    const slowTransport = {
      translate: () =>
        new Promise<{ translatedText: string }>(() => undefined),
    };
    const provider = new GoogleMtProvider({ transport: slowTransport });
    setTimeout(() => ctrl.abort(), 5);
    await expect(
      provider.translate({ text: 'hi', source: 'en', target: 'vi', signal: ctrl.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('TypeError from transport maps to network', async () => {
    const transport = {
      translate: () => Promise.reject(new TypeError('disconnected')),
    };
    const provider = new GoogleMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'en', target: 'vi' }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  test('unknown error maps to unknown code', async () => {
    const transport = {
      translate: () => Promise.reject(new Error('weird')),
    };
    const provider = new GoogleMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'en', target: 'vi' }),
    ).rejects.toMatchObject({ code: 'unknown' });
  });
});
