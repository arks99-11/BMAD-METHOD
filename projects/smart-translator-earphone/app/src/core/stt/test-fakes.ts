/**
 * Internal test fakes shared by STT adapter tests.
 *
 * Excluded from production builds via the `tsconfig.json` test exclusion
 * (`*.test.ts`). This file does not match `*.test.ts` so it is included in
 * `tsc --noEmit` and ESLint, but is never imported from non-test code.
 *
 * NOTE: this file is checked by `tsc` but excluded from coverage by the
 * Jest config in `package.json`.
 */

import type { AudioChunk } from '../audio/audio-types';
import type { WebSocketLike } from './deepgram-provider';

/**
 * Build an `AudioChunk` fixture from a sample length, filled with a
 * constant value. Used by transports that need realistic int16 PCM input.
 */
export function makeChunk(opts: {
  samples?: number;
  fill?: number;
  startSeq?: number;
  durationMs?: number;
  final?: boolean;
  utteranceBoundary?: boolean;
}): AudioChunk {
  const samples = opts.samples ?? 320; // one 20 ms frame at 16 kHz mono
  const buf = new Int16Array(samples);
  buf.fill(opts.fill ?? 0);
  return {
    samples: buf,
    startSeq: opts.startSeq ?? 0,
    endSeq: (opts.startSeq ?? 0) + Math.max(1, Math.floor(samples / 320)) - 1,
    startTimestampMs: 0,
    durationMs: opts.durationMs ?? Math.floor((samples / 16_000) * 1000),
    final: opts.final ?? false,
    utteranceBoundary: opts.utteranceBoundary ?? false,
  };
}

type WsListener<E> = (ev: E) => void;

interface WsListeners {
  open: Array<WsListener<void>>;
  close: Array<WsListener<{ code: number; reason: string }>>;
  message: Array<WsListener<{ data: string | ArrayBufferLike }>>;
  error: Array<WsListener<unknown>>;
}

export const FAKE_WS_CONNECTING = 0;
export const FAKE_WS_OPEN = 1;
export const FAKE_WS_CLOSING = 2;
export const FAKE_WS_CLOSED = 3;

/**
 * Drop-in WebSocket fake.
 *
 * Tests obtain instances via `FakeWebSocketFactory.last()` and drive them
 * by calling `.simulateOpen()`, `.simulateMessage()`, `.simulateClose()`.
 */
export class FakeWebSocket implements WebSocketLike {
  readyState: number = FAKE_WS_CONNECTING;
  readonly url: string;
  readonly authToken: string;
  readonly sentText: string[] = [];
  readonly sentBinary: ArrayBuffer[] = [];

  private readonly listeners: WsListeners = {
    open: [],
    close: [],
    message: [],
    error: [],
  };
  private closedFromClient = false;

  constructor(url: string, authToken: string) {
    this.url = url;
    this.authToken = authToken;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== FAKE_WS_OPEN) {
      throw new Error(`FakeWebSocket: send() called in readyState ${this.readyState}`);
    }
    if (typeof data === 'string') {
      this.sentText.push(data);
    } else if (data instanceof ArrayBuffer) {
      this.sentBinary.push(data.slice(0));
    } else {
      // ArrayBufferView (TypedArray, DataView). The underlying buffer may
      // be SharedArrayBuffer in some environments; copy through a fresh
      // ArrayBuffer so we always store a plain `ArrayBuffer`.
      const view = data as ArrayBufferView;
      const out = new ArrayBuffer(view.byteLength);
      new Uint8Array(out).set(
        new Uint8Array(view.buffer as ArrayBufferLike, view.byteOffset, view.byteLength),
      );
      this.sentBinary.push(out);
    }
  }

  close(code = 1000, reason = ''): void {
    if (this.closedFromClient) return;
    this.closedFromClient = true;
    this.readyState = FAKE_WS_CLOSING;
    queueMicrotask(() => {
      this.simulateClose(code, reason);
    });
  }

  addEventListener(type: 'open', listener: WsListener<void>): void;
  addEventListener(type: 'close', listener: WsListener<{ code: number; reason: string }>): void;
  addEventListener(type: 'message', listener: WsListener<{ data: string | ArrayBufferLike }>): void;
  addEventListener(type: 'error', listener: WsListener<unknown>): void;
  addEventListener(type: keyof WsListeners, listener: (ev: never) => void): void {
    // Type-erased fan-in; the public overloads above keep callers honest.
    (this.listeners[type] as Array<(ev: unknown) => void>).push(listener as (ev: unknown) => void);
  }

  // --- test helpers -------------------------------------------------------

  simulateOpen(): void {
    if (this.readyState !== FAKE_WS_CONNECTING) return;
    this.readyState = FAKE_WS_OPEN;
    for (const l of this.listeners.open) {
      l();
    }
  }

  simulateMessage(data: string | ArrayBufferLike): void {
    for (const l of this.listeners.message) {
      l({ data });
    }
  }

  simulateError(err: unknown): void {
    for (const l of this.listeners.error) {
      l(err);
    }
  }

  simulateClose(code = 1000, reason = ''): void {
    if (this.readyState === FAKE_WS_CLOSED) return;
    this.readyState = FAKE_WS_CLOSED;
    for (const l of this.listeners.close) {
      l({ code, reason });
    }
  }
}

/**
 * Track a series of created `FakeWebSocket` instances. Tests that exercise
 * connection retries can inspect the entire history.
 */
export class FakeWebSocketFactory {
  readonly created: FakeWebSocket[] = [];

  build = (url: string, opts: { authToken: string }): WebSocketLike => {
    const ws = new FakeWebSocket(url, opts.authToken);
    this.created.push(ws);
    return ws;
  };

  last(): FakeWebSocket {
    const ws = this.created[this.created.length - 1];
    if (ws === undefined) {
      throw new Error('FakeWebSocketFactory: no sockets have been created yet.');
    }
    return ws;
  }
}

// ---------------------------------------------------------------------------
// HTTP fetch fake for the Google STT REST transport.
// ---------------------------------------------------------------------------

export interface FakeHttpResponseInit {
  status?: number;
  body?: unknown;
  bodyText?: string;
  delayMs?: number;
}

export class FakeHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  private readonly bodyText: string;

  constructor(init: FakeHttpResponseInit) {
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    if (init.bodyText !== undefined) {
      this.bodyText = init.bodyText;
    } else {
      this.bodyText = JSON.stringify(init.body ?? {});
    }
  }

  async text(): Promise<string> {
    return this.bodyText;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText) as unknown;
  }
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Builds a `fetch`-shaped function that returns predetermined responses.
 *
 * Each call consumes one response from the queue. If the queue is empty
 * the fake throws a clear error so tests fail loudly rather than mysteriously.
 */
export class FakeFetcher {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: FakeHttpResponseInit[];

  constructor(responses: FakeHttpResponseInit[]) {
    this.queue = [...responses];
  }

  /**
   * Adds another response to the tail of the queue. Useful for mid-test
   * augmentation.
   */
  enqueue(response: FakeHttpResponseInit): void {
    this.queue.push(response);
  }

  fetch = async (url: string, init?: RequestInit): Promise<FakeHttpResponse> => {
    const headers: Record<string, string> = {};
    if (init?.headers !== undefined) {
      const h = init.headers;
      if (Array.isArray(h)) {
        for (const [k, v] of h) {
          headers[k.toLowerCase()] = v;
        }
      } else if (h instanceof Headers) {
        h.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
      } else {
        for (const [k, v] of Object.entries(h)) {
          headers[k.toLowerCase()] = String(v);
        }
      }
    }
    this.requests.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(`FakeFetcher: queue empty (request to ${url})`);
    }
    if (next.delayMs !== undefined) {
      await new Promise((r) => setTimeout(r, next.delayMs));
    }
    return new FakeHttpResponse(next);
  };
}
