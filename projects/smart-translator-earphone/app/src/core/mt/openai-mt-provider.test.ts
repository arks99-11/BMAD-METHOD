/**
 * Story 3.3 — GPT-4o-mini adapter tests.
 *
 * Uses a fake `OpenAiTransport` that yields tokens from a script. The
 * SSE parser is exercised separately via a fake `ReadableStream`.
 */

import {
  OpenAiHttpError,
  OpenAiMtProvider,
  type OpenAiChatRequest,
  type OpenAiTransport,
} from './openai-mt-provider';

class FakeOpenAiTransport implements OpenAiTransport {
  lastRequest: OpenAiChatRequest | null = null;
  private readonly tokens: string[];
  private readonly thrown: unknown;
  private readonly delay: number;

  constructor(opts: { tokens?: string[]; throws?: unknown; delay?: number } = {}) {
    this.tokens = opts.tokens ?? [];
    this.thrown = opts.throws;
    this.delay = opts.delay ?? 0;
  }

  async *streamChat(req: OpenAiChatRequest): AsyncIterable<string> {
    this.lastRequest = req;
    if (this.thrown !== undefined) {
      // Yield once, then throw.
      throw this.thrown;
    }
    for (const t of this.tokens) {
      if (this.delay > 0) {
        await new Promise((r) => setTimeout(r, this.delay));
      }
      // Cooperative cancel point: if signal is aborted, stop yielding.
      if (req.signal?.aborted === true) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      yield t;
    }
  }
}

describe('Story 3.3 — OpenAiMtProvider', () => {
  test('streams tokens and resolves with the joined translation', async () => {
    const transport = new FakeOpenAiTransport({
      tokens: ['Xin ', 'chào', ' bạn'],
    });
    const provider = new OpenAiMtProvider({ transport });
    const stream = provider.translateStream({
      text: 'Hello you',
      source: 'EN',
      target: 'VI',
    });
    const tokens: string[] = [];
    stream.on((ev) => {
      if (ev.type === 'chunk') tokens.push(ev.text);
    });
    const result = await stream.done;
    expect(tokens).toEqual(['Xin ', 'chào', ' bạn']);
    expect(result.text).toBe('Xin chào bạn');
    expect(result.engine).toBe('gpt-4o-mini');
  });

  test('builds a system prompt with source/target/glossary', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['x'] });
    const provider = new OpenAiMtProvider({ transport });
    await provider.translate({
      text: 'hello',
      source: 'EN',
      target: 'DE',
      glossary: new Map([['DeepL', 'DeepL']]),
    });
    const system = transport.lastRequest!.messages[0]!;
    expect(system.role).toBe('system');
    expect(system.content).toMatch(/professional simultaneous interpreter/);
    expect(system.content).toMatch(/from EN to DE/);
    expect(system.content).toMatch(/Glossary/);
    expect(system.content).toMatch(/"DeepL".*"DeepL"/);
  });

  test('source "auto" mentions "detected source language" in the prompt', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['x'] });
    const provider = new OpenAiMtProvider({ transport });
    await provider.translate({ text: 'hello', source: 'auto', target: 'DE' });
    const system = transport.lastRequest!.messages[0]!;
    expect(system.content).toMatch(/detected source language/);
  });

  test('rolling context: replays previous turns as user/assistant pairs', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['Hallo'] });
    const provider = new OpenAiMtProvider({ transport, contextTurns: 5 });
    await provider.translate({ text: 'Hi there', source: 'EN', target: 'DE' });
    transport.lastRequest = null;
    await provider.translate({ text: 'How are you?', source: 'EN', target: 'DE' });
    const messages = transport.lastRequest!.messages;
    // [system, prev user, prev assistant, this user]
    expect(messages.length).toBe(4);
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toBe('Hi there');
    expect(messages[2]!.role).toBe('assistant');
    expect(messages[2]!.content).toBe('Hallo');
    expect(messages[3]!.role).toBe('user');
    expect(messages[3]!.content).toBe('How are you?');
  });

  test('rolling context bounded by contextTurns', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['ok'] });
    const provider = new OpenAiMtProvider({ transport, contextTurns: 2 });
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await provider.translate({ text: `say ${i}`, source: 'EN', target: 'DE' });
    }
    expect(provider.contextSize()).toBe(2);
  });

  test('resetContext clears history', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['ok'] });
    const provider = new OpenAiMtProvider({ transport });
    await provider.translate({ text: 'hi', source: 'EN', target: 'DE' });
    expect(provider.contextSize()).toBe(1);
    provider.resetContext();
    expect(provider.contextSize()).toBe(0);
  });

  test('strips surrounding straight quotes from the model output', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['"', 'Hallo', '"'] });
    const provider = new OpenAiMtProvider({ transport });
    const result = await provider.translate({ text: 'Hi', source: 'EN', target: 'DE' });
    expect(result.text).toBe('Hallo');
  });

  test('strips smart quotes from the model output', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['\u201C', 'Hallo', '\u201D'] });
    const provider = new OpenAiMtProvider({ transport });
    const result = await provider.translate({ text: 'Hi', source: 'EN', target: 'DE' });
    expect(result.text).toBe('Hallo');
  });

  test('AbortSignal cancels mid-stream', async () => {
    const transport = new FakeOpenAiTransport({
      tokens: ['a', 'b', 'c'],
      delay: 20,
    });
    const provider = new OpenAiMtProvider({ transport });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await expect(
      provider.translate({
        text: 'hello',
        source: 'EN',
        target: 'DE',
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('OpenAiHttpError 401 maps to auth code', async () => {
    const transport = new FakeOpenAiTransport({
      throws: new OpenAiHttpError(401, 'no'),
    });
    const provider = new OpenAiMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE' }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  test('OpenAiHttpError 429 maps to rate-limited', async () => {
    const transport = new FakeOpenAiTransport({
      throws: new OpenAiHttpError(429, 'rl'),
    });
    const provider = new OpenAiMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
  });

  test('TypeError maps to network code', async () => {
    const transport = new FakeOpenAiTransport({
      throws: new TypeError('disconnected'),
    });
    const provider = new OpenAiMtProvider({ transport });
    await expect(
      provider.translate({ text: 'hi', source: 'EN', target: 'DE' }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  test('formality preference is included in the system prompt', async () => {
    const transport = new FakeOpenAiTransport({ tokens: ['x'] });
    const provider = new OpenAiMtProvider({ transport });
    await provider.translate({
      text: 'hi',
      source: 'EN',
      target: 'DE',
      formality: 'more',
    });
    const system = transport.lastRequest!.messages[0]!;
    expect(system.content).toMatch(/Formality preference: more/);
  });
});
