/**
 * Story 2.2 — Google Cloud Speech-to-Text adapter (tests).
 */

import {
  GoogleSttProvider,
  RestGoogleSttTransport,
  int16ToBase64,
} from './google-stt-provider';
import type { SttEvent } from './stt-types';
import { FakeFetcher, makeChunk } from './test-fakes';

describe('Story 2.2 — int16ToBase64', () => {
  test('encodes a known fixture as little-endian int16', () => {
    const samples = new Int16Array([0x1234, -1, 0]);
    // little-endian:
    //   0x1234 → 34 12
    //   -1     → ff ff
    //   0      → 00 00
    // bytes: 34 12 ff ff 00 00 → base64 'NBL//wAA'
    expect(int16ToBase64(samples)).toBe('NBL//wAA');
  });
});

describe('Story 2.2 — RestGoogleSttTransport', () => {
  test('POSTs to the recognize endpoint with the API key in the query string', async () => {
    const fetcher = new FakeFetcher([
      {
        body: {
          results: [
            {
              alternatives: [{ transcript: 'hello', confidence: 0.9 }],
              languageCode: 'en-US',
            },
          ],
        },
      },
    ]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const results = await transport.recognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16_000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        profanityFilter: false,
        model: 'latest_short',
        interimResults: true,
      },
      audio: { content: 'AAAA' },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.alternatives[0]?.transcript).toBe('hello');
    expect(results[0]?.isFinal).toBe(true);
    expect(fetcher.requests[0]?.url).toContain('?key=KEY');
    expect(fetcher.requests[0]?.method).toBe('POST');
    expect(fetcher.requests[0]?.headers['content-type']).toBe('application/json');
    const body = JSON.parse(fetcher.requests[0]!.body) as {
      config: { languageCode: string };
    };
    expect(body.config.languageCode).toBe('en-US');
  });

  test('throws GoogleSttHttpError on a non-2xx status', async () => {
    const fetcher = new FakeFetcher([
      { status: 401, bodyText: 'Unauthorized' },
    ]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      transport.recognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16_000,
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
          profanityFilter: false,
          model: 'latest_short',
          interimResults: false,
        },
        audio: { content: 'AAAA' },
      }),
    ).rejects.toThrow(/401/);
  });

  test('rejects an empty apiKey', () => {
    expect(
      () =>
        new RestGoogleSttTransport({
          apiKey: '',
          fetcher: new FakeFetcher([]).fetch as unknown as typeof fetch,
        }),
    ).toThrow(/apiKey/);
  });
});

describe('Story 2.2 — GoogleSttProvider', () => {
  test('emits final event for each recognised chunk in REST mode', async () => {
    const fetcher = new FakeFetcher([
      {
        body: {
          results: [
            {
              alternatives: [{ transcript: 'one', confidence: 0.7 }],
              languageCode: 'en-US',
            },
          ],
        },
      },
      {
        body: {
          results: [
            {
              alternatives: [{ transcript: 'two', confidence: 0.8 }],
              languageCode: 'en-US',
            },
          ],
        },
      },
    ]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport });
    const events: SttEvent[] = [];
    const session = await provider.start({ lang: 'en-US' });
    session.on((ev) => events.push(ev));

    session.send(makeChunk({}));
    session.send(makeChunk({ startSeq: 1 }));
    await session.end();

    expect(events.filter((e) => e.type === 'final')).toHaveLength(2);
    if (events[0]?.type === 'final') {
      expect(events[0].transcript).toBe('one');
    }
    expect(events[events.length - 1]?.type).toBe('closed');
  });

  test('lecture mode uses latest_long model', async () => {
    const fetcher = new FakeFetcher([{ body: { results: [] } }]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport, mode: 'lecture' });
    const session = await provider.start({ lang: 'en-US' });
    session.send(makeChunk({}));
    await session.end();
    const body = JSON.parse(fetcher.requests[0]!.body) as {
      config: { model: string };
    };
    expect(body.config.model).toBe('latest_long');
  });

  test('autoLanguageDetect plumbs alternativeLanguageCodes', async () => {
    const fetcher = new FakeFetcher([
      {
        body: {
          results: [
            {
              alternatives: [{ transcript: 'hola', confidence: 0.8 }],
              languageCode: 'es-ES',
              languageConfidence: 0.93,
            },
          ],
        },
      },
    ]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({
      transport,
      alternativeLanguageCodes: ['es-ES', 'fr-FR', 'de-DE', 'it-IT'], // 4 → capped to 3
    });
    const events: SttEvent[] = [];
    const session = await provider.start({ lang: 'en-US', autoLanguageDetect: true });
    session.on((ev) => events.push(ev));
    session.send(makeChunk({}));
    await session.end();

    const body = JSON.parse(fetcher.requests[0]!.body) as {
      config: { alternativeLanguageCodes: string[] };
    };
    expect(body.config.alternativeLanguageCodes).toEqual(['es-ES', 'fr-FR', 'de-DE']);

    expect(events.find((e) => e.type === 'language-detected')).toEqual({
      type: 'language-detected',
      lang: 'es-ES',
      confidence: 0.93,
    });
  });

  test('autoLanguageDetect does not include alternativeLanguageCodes when none configured', async () => {
    const fetcher = new FakeFetcher([{ body: { results: [] } }]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport });
    const session = await provider.start({ lang: 'en-US', autoLanguageDetect: true });
    session.send(makeChunk({}));
    await session.end();
    const body = JSON.parse(fetcher.requests[0]!.body) as {
      config: { alternativeLanguageCodes?: unknown };
    };
    expect(body.config.alternativeLanguageCodes).toBeUndefined();
  });

  test('language-detected fires only once when the same language repeats', async () => {
    const fetcher = new FakeFetcher([
      {
        body: {
          results: [
            { alternatives: [{ transcript: 'a' }], languageCode: 'es-ES', languageConfidence: 0.9 },
          ],
        },
      },
      {
        body: {
          results: [
            { alternatives: [{ transcript: 'b' }], languageCode: 'es-ES', languageConfidence: 0.92 },
          ],
        },
      },
    ]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({
      transport,
      alternativeLanguageCodes: ['es-ES'],
    });
    const events: SttEvent[] = [];
    const session = await provider.start({ lang: 'en-US', autoLanguageDetect: true });
    session.on((ev) => events.push(ev));
    session.send(makeChunk({}));
    session.send(makeChunk({ startSeq: 1 }));
    await session.end();
    expect(events.filter((e) => e.type === 'language-detected')).toHaveLength(1);
  });

  test('HTTP 401 maps to auth error code', async () => {
    const fetcher = new FakeFetcher([{ status: 401, bodyText: 'no' }]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport });
    const events: SttEvent[] = [];
    const session = await provider.start({ lang: 'en-US' });
    session.on((ev) => events.push(ev));
    session.send(makeChunk({}));
    await session.end();
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      type: 'error',
      code: 'auth',
    });
  });

  test('HTTP 429 maps to rate-limited', async () => {
    const fetcher = new FakeFetcher([{ status: 429, bodyText: 'slow down' }]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport });
    const events: SttEvent[] = [];
    const session = await provider.start({ lang: 'en-US' });
    session.on((ev) => events.push(ev));
    session.send(makeChunk({}));
    await session.end();
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      type: 'error',
      code: 'rate-limited',
    });
  });

  test('end() awaits all in-flight recognise calls before closing', async () => {
    const fetcher = new FakeFetcher([
      { delayMs: 10, body: { results: [{ alternatives: [{ transcript: 'late' }] }] } },
    ]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport });
    const events: SttEvent[] = [];
    const session = await provider.start({ lang: 'en-US' });
    session.on((ev) => events.push(ev));
    session.send(makeChunk({}));
    await session.end();
    // Final event must arrive before closed.
    const finalIdx = events.findIndex((e) => e.type === 'final');
    const closedIdx = events.findIndex((e) => e.type === 'closed');
    expect(finalIdx).toBeGreaterThanOrEqual(0);
    expect(closedIdx).toBeGreaterThan(finalIdx);
  });

  test('AbortSignal cancels the session', async () => {
    const fetcher = new FakeFetcher([{ body: { results: [] } }]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport });
    const ctrl = new AbortController();
    const events: SttEvent[] = [];
    const session = await provider.start({ lang: 'en-US', signal: ctrl.signal });
    session.on((ev) => events.push(ev));
    ctrl.abort();
    await session.end();
    expect(events.find((e) => e.type === 'error' && e.code === 'cancelled')).toBeDefined();
    expect(events[events.length - 1]?.type).toBe('closed');
  });

  test('send() after end() throws', async () => {
    const fetcher = new FakeFetcher([]);
    const transport = new RestGoogleSttTransport({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const provider = new GoogleSttProvider({ transport });
    const session = await provider.start({ lang: 'en-US' });
    await session.end();
    expect(() => session.send(makeChunk({}))).toThrow(/after end/);
  });
});
