/**
 * Story 4.2 — Azure TTS adapter tests.
 */

import { AzureTtsProvider, buildSsml } from './azure-tts-provider';
import { FakeStreamingFetcher, bytes } from './test-fakes';

describe('buildSsml', () => {
  test('builds basic SSML envelope', () => {
    const ssml = buildSsml({
      text: 'Hello',
      voice: 'en-US-JennyNeural',
      language: 'EN',
    });
    expect(ssml).toContain('<speak version="1.0" xml:lang="EN">');
    expect(ssml).toContain('<voice xml:lang="EN" name="en-US-JennyNeural">');
    expect(ssml).toContain('Hello');
    expect(ssml).toContain('</voice></speak>');
  });

  test('escapes special XML characters in text', () => {
    const ssml = buildSsml({
      text: 'Tom & Jerry <script>',
      voice: 'v',
      language: 'EN',
    });
    expect(ssml).toContain('Tom &amp; Jerry &lt;script&gt;');
  });

  test('wraps text in prosody when rate is set', () => {
    const ssml = buildSsml({
      text: 'hi',
      voice: 'v',
      language: 'EN',
      rate: 1.5,
    });
    expect(ssml).toContain('<prosody rate="+50%">hi</prosody>');
  });

  test('wraps text in prosody when pitch is set', () => {
    const ssml = buildSsml({
      text: 'hi',
      voice: 'v',
      language: 'EN',
      pitch: 4,
    });
    expect(ssml).toContain('<prosody pitch="4st">hi</prosody>');
  });

  test('combines rate and pitch in one prosody element', () => {
    const ssml = buildSsml({
      text: 'hi',
      voice: 'v',
      language: 'EN',
      rate: 0.8,
      pitch: -2,
    });
    expect(ssml).toContain('<prosody rate="-20%" pitch="-2st">hi</prosody>');
  });

  test('clamps rate beyond ±100% to ±100%', () => {
    const ssml = buildSsml({
      text: 'hi',
      voice: 'v',
      language: 'EN',
      rate: 5,
    });
    expect(ssml).toContain('rate="+100%"');
  });
});

describe('Story 4.2 — AzureTtsProvider', () => {
  test('POSTs SSML body with expected Azure headers', async () => {
    const fetcher = new FakeStreamingFetcher([{ chunks: [bytes(1, 2, 3)] }]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const result = await provider.synthesize({
      text: 'Hello',
      voice: 'en-US-JennyNeural',
      language: 'EN',
    });
    expect(result.audio.byteLength).toBe(3);
    expect(result.format).toBe('pcm-s16le-24k');
    const req = fetcher.requests[0]!;
    expect(req.url).toBe(
      'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1',
    );
    expect(req.method).toBe('POST');
    expect(req.headers['ocp-apim-subscription-key']).toBe('SK');
    expect(req.headers['content-type']).toBe('application/ssml+xml');
    expect(req.headers['x-microsoft-outputformat']).toBe('raw-24khz-16bit-mono-pcm');
    expect(req.body).toContain('<speak');
    expect(req.body).toContain('en-US-JennyNeural');
  });

  test('streams chunks via synthesizeStream', async () => {
    const fetcher = new FakeStreamingFetcher([
      { chunks: [bytes(1, 2), bytes(3, 4)] },
    ]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const stream = provider.synthesizeStream({
      text: 'hi',
      voice: 'en-US-JennyNeural',
      language: 'EN',
    });
    const chunks: number[] = [];
    stream.on((ev) => {
      if (ev.type === 'chunk') chunks.push(...ev.audio);
    });
    await stream.done;
    expect(chunks).toEqual([1, 2, 3, 4]);
  });

  test('respects opus-48k format', async () => {
    const fetcher = new FakeStreamingFetcher([{ chunks: [bytes(0)] }]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await provider.synthesize({
      text: 'hi',
      voice: 'en-US-JennyNeural',
      language: 'EN',
      format: 'opus-48k',
    });
    expect(fetcher.requests[0]!.headers['x-microsoft-outputformat']).toBe(
      'ogg-48khz-16bit-mono-opus',
    );
  });

  test('HTTP 401 maps to auth', async () => {
    const fetcher = new FakeStreamingFetcher([{ status: 401, bodyText: 'no' }]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'en-US-JennyNeural', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  test('HTTP 429 maps to rate-limited', async () => {
    const fetcher = new FakeStreamingFetcher([{ status: 429, bodyText: 'rl' }]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'en-US-JennyNeural', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
  });

  test('HTTP 400 with "voice" in body maps to unsupported-voice', async () => {
    const fetcher = new FakeStreamingFetcher([
      { status: 400, bodyText: 'voice unknown' },
    ]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'badvoice', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'unsupported-voice' });
  });

  test('HTTP 400 without "voice" in body maps to invalid-input', async () => {
    const fetcher = new FakeStreamingFetcher([
      { status: 400, bodyText: 'malformed ssml' },
    ]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'v', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  test('AbortSignal during streaming raises cancelled', async () => {
    const fetcher = new FakeStreamingFetcher([
      { chunks: [bytes(1), bytes(2), bytes(3)], chunkDelayMs: 30 },
    ]);
    const provider = new AzureTtsProvider({
      subscriptionKey: 'SK',
      region: 'eastus',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await expect(
      provider.synthesize({
        text: 'hi',
        voice: 'en-US-JennyNeural',
        language: 'EN',
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('rejects empty subscriptionKey', () => {
    expect(
      () =>
        new AzureTtsProvider({
          subscriptionKey: '',
          region: 'eastus',
          fetcher: new FakeStreamingFetcher([]).fetch as unknown as typeof fetch,
        }),
    ).toThrow(/subscriptionKey/);
  });

  test('rejects missing region without explicit baseUrl', () => {
    expect(
      () =>
        new AzureTtsProvider({
          subscriptionKey: 'SK',
          region: '',
          fetcher: new FakeStreamingFetcher([]).fetch as unknown as typeof fetch,
        }),
    ).toThrow(/region/);
  });
});
