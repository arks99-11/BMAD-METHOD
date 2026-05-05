/**
 * Story 4.1 — ElevenLabs adapter tests.
 */

import { ElevenLabsProvider } from './elevenlabs-provider';
import { FakeStreamingFetcher, bytes } from './test-fakes';

describe('Story 4.1 — ElevenLabsProvider', () => {
  test('POSTs to the streaming endpoint with the expected headers and body', async () => {
    const fetcher = new FakeStreamingFetcher([
      { chunks: [bytes(1, 2, 3, 4)] },
    ]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const result = await provider.synthesize({
      text: 'Hello',
      voice: 'voice-id-1',
      language: 'EN',
    });
    expect(result.audio.byteLength).toBe(4);
    expect(result.format).toBe('pcm-s16le-24k');
    expect(result.engine).toBe('elevenlabs');
    expect(result.voice).toBe('voice-id-1');
    const req = fetcher.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toContain('voice-id-1');
    expect(req.url).toContain('output_format=pcm_24000');
    expect(req.headers['xi-api-key']).toBe('KEY');
    const body = JSON.parse(req.body) as {
      text: string;
      model_id: string;
      voice_settings: { stability: number; similarity_boost: number; style: number };
    };
    expect(body.text).toBe('Hello');
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.voice_settings.stability).toBe(0.5);
  });

  test('synthesizeStream emits chunk events for each wire chunk', async () => {
    const fetcher = new FakeStreamingFetcher([
      { chunks: [bytes(1, 2), bytes(3, 4), bytes(5, 6)] },
    ]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const stream = provider.synthesizeStream({
      text: 'hi',
      voice: 'v',
      language: 'EN',
    });
    const chunks: number[] = [];
    let finalEvent = false;
    stream.on((ev) => {
      if (ev.type === 'chunk') {
        for (const b of ev.audio) chunks.push(b);
      } else if (ev.type === 'final') {
        finalEvent = true;
      }
    });
    const result = await stream.done;
    expect(chunks).toEqual([1, 2, 3, 4, 5, 6]);
    expect(finalEvent).toBe(true);
    expect(result.audio.byteLength).toBe(6);
  });

  test('respects requested output format (pcm-s16le-16k)', async () => {
    const fetcher = new FakeStreamingFetcher([{ chunks: [bytes(0)] }]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await provider.synthesize({
      text: 'hi',
      voice: 'v',
      language: 'EN',
      format: 'pcm-s16le-16k',
    });
    expect(fetcher.requests[0]!.url).toContain('output_format=pcm_16000');
  });

  test('respects requested output format (mp3-44k)', async () => {
    const fetcher = new FakeStreamingFetcher([{ chunks: [bytes(0)] }]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await provider.synthesize({
      text: 'hi',
      voice: 'v',
      language: 'EN',
      format: 'mp3-44k',
    });
    expect(fetcher.requests[0]!.url).toContain('output_format=mp3_44100_128');
  });

  test('rejects unsupported audio format with engine error', async () => {
    const fetcher = new FakeStreamingFetcher([]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({
        text: 'hi',
        voice: 'v',
        language: 'EN',
        format: 'opus-48k',
      }),
    ).rejects.toMatchObject({ code: 'engine' });
  });

  test('HTTP 401 maps to auth', async () => {
    const fetcher = new FakeStreamingFetcher([{ status: 401, bodyText: 'no' }]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'v', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  test('HTTP 429 maps to rate-limited', async () => {
    const fetcher = new FakeStreamingFetcher([{ status: 429, bodyText: 'rl' }]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'v', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
  });

  test('HTTP 422 with "voice" in body maps to unsupported-voice', async () => {
    const fetcher = new FakeStreamingFetcher([
      { status: 422, bodyText: 'voice not found' },
    ]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'unknown', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'unsupported-voice' });
  });

  test('HTTP 422 without "voice" in body maps to invalid-input', async () => {
    const fetcher = new FakeStreamingFetcher([
      { status: 422, bodyText: 'text too long' },
    ]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: 'hi', voice: 'v', language: 'EN' }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  test('AbortSignal during streaming raises cancelled', async () => {
    const fetcher = new FakeStreamingFetcher([
      { chunks: [bytes(1), bytes(2), bytes(3), bytes(4)], chunkDelayMs: 30 },
    ]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await expect(
      provider.synthesize({
        text: 'hi',
        voice: 'v',
        language: 'EN',
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('rejects empty apiKey', () => {
    expect(
      () =>
        new ElevenLabsProvider({
          apiKey: '',
          fetcher: new FakeStreamingFetcher([]).fetch as unknown as typeof fetch,
        }),
    ).toThrow(/apiKey/);
  });

  test('voice_settings forwards constructor overrides', async () => {
    const fetcher = new FakeStreamingFetcher([{ chunks: [bytes(0)] }]);
    const provider = new ElevenLabsProvider({
      apiKey: 'KEY',
      stability: 0.9,
      similarityBoost: 0.4,
      style: 0.2,
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    await provider.synthesize({ text: 'hi', voice: 'v', language: 'EN' });
    const body = JSON.parse(fetcher.requests[0]!.body) as {
      voice_settings: { stability: number; similarity_boost: number; style: number };
    };
    expect(body.voice_settings).toEqual({
      stability: 0.9,
      similarity_boost: 0.4,
      style: 0.2,
    });
  });
});
