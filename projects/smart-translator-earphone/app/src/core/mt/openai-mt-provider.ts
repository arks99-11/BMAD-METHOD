/**
 * Story 3.3 — OpenAI GPT-4o-mini adapter (Pro / context-aware MT).
 *
 * Implements `MtProvider` over OpenAI's Chat Completions API with
 * `stream: true`. The streaming surface lets the UI start rendering
 * the translation as soon as the first token arrives — important for
 * the Pro tier where end-to-end latency is the primary differentiator.
 *
 * Rolling context window (PRD §3.4):
 *  - The provider keeps a bounded history of recent translations
 *    (default 10 turns / ~2 KB of text). On every translate call,
 *    the history is injected into the system prompt so the model can
 *    maintain pronoun reference, terminology consistency, and tone.
 *  - The window is per-provider-instance. The orchestrator resets it
 *    on language change or session end.
 *
 * Glossary handling:
 *  - Glossary terms are injected into the system prompt as
 *    `<term>source ⇒ target</term>` lines. The model is instructed to
 *    use the target term verbatim. Quality is good enough for v1; a
 *    future story (3.6) will move to managed glossaries.
 *
 * Transport abstraction:
 *  - `OpenAiTransport.streamChat(req)` returns an `AsyncIterable<string>`
 *    of incremental tokens. The default implementation (`OpenAiHttpTransport`)
 *    speaks SSE; tests inject `FakeOpenAiTransport` directly.
 */

import { abortablePromise } from './base-mt-provider';
import {
  MtError,
  type MtProvider,
  type MtRequest,
  type MtResult,
  type MtStream,
  type MtStreamEvent,
  type MtStreamListener,
} from './mt-types';

const DEFAULT_CONTEXT_TURNS = 10;
const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAiTransport {
  streamChat(req: OpenAiChatRequest): AsyncIterable<string>;
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiHttpTransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  organization?: string;
}

export class OpenAiHttpTransport implements OpenAiTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly organization: string | undefined;

  constructor(opts: OpenAiHttpTransportOptions) {
    if (!opts.apiKey) {
      throw new Error('OpenAiHttpTransport: apiKey is required.');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1/chat/completions';
    if (opts.fetcher !== undefined) {
      this.fetcher = opts.fetcher;
    } else if (typeof fetch !== 'undefined') {
      this.fetcher = fetch;
    } else {
      throw new Error(
        'OpenAiHttpTransport: no global fetch available. Pass `fetcher` in non-browser/non-RN environments.',
      );
    }
    this.organization = opts.organization;
  }

  // eslint-disable-next-line require-yield
  async *streamChat(req: OpenAiChatRequest): AsyncIterable<string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    };
    if (this.organization !== undefined) {
      headers['openai-organization'] = this.organization;
    }
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        stream: true,
      }),
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    };
    const res = await this.fetcher(this.baseUrl, init);
    if (!res.ok) {
      const body = await safeReadText(res);
      throw new OpenAiHttpError(res.status, body);
    }
    if (res.body === null || res.body === undefined) {
      throw new OpenAiHttpError(res.status, 'OpenAI stream had empty body.');
    }
    yield* parseSseStream(res.body);
  }
}

export class OpenAiHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`OpenAI request failed: ${status} ${body}`);
    this.status = status;
    this.body = body;
    this.name = 'OpenAiHttpError';
  }
}

/**
 * Parse OpenAI's SSE stream into incremental token strings. Filters out
 * `[DONE]` sentinel and chunks without `choices[0].delta.content`.
 */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE messages are separated by a blank line.
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = block
        .split('\n')
        .find((l) => l.startsWith('data:'));
      if (dataLine === undefined) continue;
      const payload = dataLine.slice('data:'.length).trim();
      if (payload === '' || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = parsed.choices?.[0]?.delta?.content;
        if (typeof token === 'string' && token.length > 0) {
          yield token;
        }
      } catch {
        // Ignore malformed SSE chunks; OpenAI never sends them in
        // practice but partial decodes can.
      }
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export interface OpenAiMtProviderOptions {
  transport: OpenAiTransport;
  /** Defaults to 'gpt-4o-mini'. */
  model?: string;
  /** Defaults to 10 turns. */
  contextTurns?: number;
  /** Defaults to 0.3 — bias toward faithful translation. */
  temperature?: number;
}

interface ContextTurn {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
}

export class OpenAiMtProvider implements MtProvider {
  readonly engine = 'gpt-4o-mini' as const;

  private readonly transport: OpenAiTransport;
  private readonly model: string;
  private readonly contextTurns: number;
  private readonly temperature: number;
  private readonly history: ContextTurn[] = [];

  constructor(opts: OpenAiMtProviderOptions) {
    this.transport = opts.transport;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.contextTurns = opts.contextTurns ?? DEFAULT_CONTEXT_TURNS;
    this.temperature = opts.temperature ?? 0.3;
  }

  /**
   * Clear the rolling context. Call on language change or session end.
   */
  resetContext(): void {
    this.history.length = 0;
  }

  contextSize(): number {
    return this.history.length;
  }

  async translate(req: MtRequest): Promise<MtResult> {
    const stream = this.translateStream(req);
    return stream.done;
  }

  translateStream(req: MtRequest): MtStream {
    const messages = this.buildMessages(req);
    const listeners = new Set<MtStreamListener>();
    const queued: MtStreamEvent[] = [];
    let terminal: MtStreamEvent | null = null;
    let buffer = '';
    const start = Date.now();

    const dispatch = (ev: MtStreamEvent): void => {
      if (terminal !== null) return;
      if (ev.type === 'final' || ev.type === 'error') {
        terminal = ev;
      }
      if (listeners.size === 0) {
        queued.push(ev);
        return;
      }
      for (const l of listeners) {
        l(ev);
      }
    };

    const done = (async (): Promise<MtResult> => {
      try {
        const transportReq: OpenAiChatRequest = {
          model: this.model,
          messages,
          temperature: this.temperature,
          ...(req.signal !== undefined ? { signal: req.signal } : {}),
        };
        const aborted = abortablePromise(req.signal, this.engine);
        const iter = this.transport.streamChat(transportReq);
        const reader = iter[Symbol.asyncIterator]();
        for (;;) {
          const next = await Promise.race([reader.next(), aborted]);
          if (next.done === true) break;
          const token = next.value;
          buffer += token;
          dispatch({ type: 'chunk', text: token });
        }
        const cleaned = stripQuotes(buffer);
        const result: MtResult = {
          text: cleaned,
          engine: this.engine,
          durationMs: Date.now() - start,
        };
        this.history.push({
          source: req.text,
          target: cleaned,
          sourceLang: req.source === 'auto' ? '' : req.source,
          targetLang: req.target,
        });
        // Trim history to the last N turns.
        if (this.history.length > this.contextTurns) {
          this.history.splice(0, this.history.length - this.contextTurns);
        }
        dispatch({ type: 'final', result });
        return result;
      } catch (err) {
        const error = mapOpenAiError(err);
        dispatch({ type: 'error', error });
        throw error;
      }
    })();

    return {
      engine: this.engine,
      on(listener: MtStreamListener): () => void {
        if (queued.length > 0 && listeners.size === 0) {
          const replay = [...queued];
          queued.length = 0;
          for (const ev of replay) {
            listener(ev);
          }
        } else if (terminal !== null) {
          listener(terminal);
        }
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      done,
    };
  }

  private buildMessages(req: MtRequest): OpenAiMessage[] {
    const sysParts: string[] = [
      'You are a professional simultaneous interpreter.',
      `Translate from ${req.source === 'auto' ? 'the detected source language' : req.source} to ${req.target}.`,
      'Output only the translation. Do not add commentary, quotes, or alternatives.',
      'Preserve speaker tone and formality. Maintain pronoun reference and terminology across turns.',
    ];
    if (req.formality !== undefined && req.formality !== 'default') {
      sysParts.push(`Formality preference: ${req.formality}.`);
    }
    if (req.glossary !== undefined && req.glossary.size > 0) {
      sysParts.push('Glossary (use the target term verbatim):');
      for (const [from, to] of req.glossary) {
        sysParts.push(`- "${from}" ⇒ "${to}"`);
      }
    }
    const messages: OpenAiMessage[] = [{ role: 'system', content: sysParts.join('\n') }];
    // Replay rolling context so the model maintains coherence.
    for (const turn of this.history) {
      messages.push({ role: 'user', content: turn.source });
      messages.push({ role: 'assistant', content: turn.target });
    }
    messages.push({ role: 'user', content: req.text });
    return messages;
  }
}

function mapOpenAiError(err: unknown): MtError {
  if (err instanceof MtError) return err;
  if (err instanceof OpenAiHttpError) {
    if (err.status === 401 || err.status === 403) {
      return new MtError('auth', 'gpt-4o-mini', err.body || 'OpenAI auth failed.', err.status);
    }
    if (err.status === 429) {
      return new MtError(
        'rate-limited',
        'gpt-4o-mini',
        err.body || 'OpenAI rate-limited.',
        err.status,
      );
    }
    if (err.status === 400) {
      return new MtError(
        'invalid-input',
        'gpt-4o-mini',
        err.body || 'OpenAI rejected the request.',
        err.status,
      );
    }
    if (err.status >= 500) {
      return new MtError('engine', 'gpt-4o-mini', err.body || 'OpenAI server error.', err.status);
    }
    return new MtError(
      'engine',
      'gpt-4o-mini',
      err.body || `OpenAI HTTP ${err.status}.`,
      err.status,
    );
  }
  if (err instanceof TypeError) {
    return new MtError('network', 'gpt-4o-mini', err.message);
  }
  return new MtError('unknown', 'gpt-4o-mini', err instanceof Error ? err.message : String(err));
}

/**
 * GPT-4o-mini occasionally wraps its output in quotes despite the
 * system prompt. Strip a single matched pair on either side.
 */
function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    const first = t.charAt(0);
    const last = t.charAt(t.length - 1);
    if (
      (first === '"' && last === '"') ||
      (first === '\u201C' && last === '\u201D') ||
      (first === '\u201E' && last === '\u201C')
    ) {
      return t.slice(1, -1);
    }
  }
  return t;
}
