import { GoogleTranslateFreeProvider } from './google-translate-free-provider';

function fakeFetch(json: unknown, ok = true, status = 200): typeof fetch {
  return jest.fn(async () => ({
    ok,
    status,
    async json() {
      return json;
    },
  })) as unknown as typeof fetch;
}

describe('GoogleTranslateFreeProvider', () => {
  it('isAvailable() returns true with no API key', () => {
    const p = new GoogleTranslateFreeProvider();
    expect(p.isAvailable()).toBe(true);
  });

  it('parses a simple single-chunk response', async () => {
    const fetchFn = fakeFetch([[['Hola', 'Hello', null, null, 0]], null, 'en']);
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    const r = await p.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es' });
    expect(r.text).toBe('Hola');
    expect(r.sourceLang).toBe('en');
    expect(r.targetLang).toBe('es');
    expect(r.engine).toBe('google');
  });

  it('concatenates multi-chunk responses (long sentences)', async () => {
    const fetchFn = fakeFetch([
      [
        ['Hola, ', 'Hello, ', null, null, 0],
        ['¿cómo estás?', 'how are you?', null, null, 0],
      ],
      null,
      'en',
    ]);
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    const r = await p.translate({
      text: 'Hello, how are you?',
      sourceLang: 'en',
      targetLang: 'es',
    });
    expect(r.text).toBe('Hola, ¿cómo estás?');
    expect(r.sourceLang).toBe('en');
  });

  it('uses the detected language when sourceLang is auto', async () => {
    const fetchFn = fakeFetch([[['Bonjour', 'Hello', null, null, 0]], null, 'en']);
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    const r = await p.translate({ text: 'Hello', sourceLang: 'auto', targetLang: 'fr' });
    expect(r.sourceLang).toBe('en');
  });

  it('passes sl=auto in the URL when sourceLang is auto', async () => {
    const fetchFn = fakeFetch([[['Hola', 'Hello', null, null, 0]], null, 'en']);
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    await p.translate({ text: 'Hello', sourceLang: 'auto', targetLang: 'es' });
    const url = (fetchFn as jest.Mock).mock.calls[0][0] as string;
    expect(url).toMatch(/sl=auto/);
    expect(url).toMatch(/tl=es/);
    expect(url).toMatch(/q=Hello/);
  });

  it('throws on non-2xx HTTP responses', async () => {
    const fetchFn = fakeFetch(null, false, 429);
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    await expect(
      p.translate({ text: 'hi', sourceLang: 'en', targetLang: 'es' }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it('throws on a malformed response shape', async () => {
    const fetchFn = fakeFetch({ unexpected: 'object' });
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    await expect(
      p.translate({ text: 'hi', sourceLang: 'en', targetLang: 'es' }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it('throws when the chunks array is empty', async () => {
    const fetchFn = fakeFetch([null, null, 'en']);
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    await expect(
      p.translate({ text: 'hi', sourceLang: 'en', targetLang: 'es' }),
    ).rejects.toThrow(/no translation chunks/);
  });

  it('throws when concatenated translation is empty', async () => {
    const fetchFn = fakeFetch([[[null, 'Hello', null, null, 0]], null, 'en']);
    const p = new GoogleTranslateFreeProvider({ fetchFn });
    await expect(
      p.translate({ text: 'hi', sourceLang: 'en', targetLang: 'es' }),
    ).rejects.toThrow(/empty translation/);
  });

  it('honors a custom endpoint override', async () => {
    const fetchFn = fakeFetch([[['Hola', 'Hello', null, null, 0]], null, 'en']);
    const p = new GoogleTranslateFreeProvider({
      fetchFn,
      endpoint: 'https://example.test/translate',
    });
    await p.translate({ text: 'hi', sourceLang: 'en', targetLang: 'es' });
    const url = (fetchFn as jest.Mock).mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/example\.test\/translate\?/);
  });
});
