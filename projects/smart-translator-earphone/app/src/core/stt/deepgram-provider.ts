/**
 * Story 2.1 — Deepgram cloud STT adapter.
 *
 * Streams the audio pipeline's `AudioChunk` output to the Deepgram realtime
 * WebSocket endpoint (`wss://api.deepgram.com/v1/listen`) and translates
 * Deepgram's JSON message shape into the engine-agnostic `SttEvent` union
 * defined in `stt-types.ts`.
 *
 * Design notes:
 *
 *  - The WebSocket dependency is **injected** via `WebSocketFactory`. In a
 *    React Native runtime the global `WebSocket` is used. In Node-based
 *    Jest tests a fake factory returns an in-memory `FakeWebSocket` so we
 *    never depend on real network I/O during CI.
 *
 *  - Deepgram's WebSocket API does NOT support automatic language
 *    detection on a streaming connection (validated in V-05). When
 *    `autoLanguageDetect` is requested, the adapter logs a warning via the
 *    `error` channel with `code: 'unsupported-language'` and proceeds with
 *    the explicit `lang` hint. The engine router (Story 2.5) is expected
 *    to route auto-detect requests to Google or Whisper, not Deepgram.
 *
 *  - The audio sent on the wire is the raw int16 little-endian PCM bytes
 *    extracted from each `AudioChunk.samples`. Deepgram is told the
 *    encoding via the URL query string (`?encoding=linear16&sample_rate=
 *    16000&channels=1`). No re-sampling occurs; the pipeline guarantees
 *    16 kHz mono int16 frames (`audio-types.ts`).
 */

import type { AudioChunk } from '../audio/audio-types';
import type {
  SttEvent,
  SttEventListener,
  SttProvider,
  SttSession,
  SttStartOptions,
} from './stt-types';

/**
 * Minimal WebSocket surface used by the Deepgram adapter. The shape is
 * compatible with the global `WebSocket` and with our test
 * `FakeWebSocket`.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: 'message', listener: (ev: { data: string | ArrayBufferLike }) => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
}

/**
 * Constructs a `WebSocketLike` for a given URL with optional headers
 * (Deepgram requires `Authorization: Token <key>`).
 *
 * In a real RN runtime this is implemented by passing the auth token in
 * the URL query string (RN's WebSocket does not accept custom headers
 * directly), but the abstraction here lets us choose at runtime.
 */
export type WebSocketFactory = (url: string, opts: { authToken: string }) => WebSocketLike;

export interface DeepgramProviderOptions {
  /**
   * Deepgram API token. Pulled from secure storage at session start;
   * never logged.
   */
  apiToken: string;

  /**
   * WebSocket factory injected for testability. Defaults to the global
   * `WebSocket` constructor; tests pass a `FakeWebSocketFactory`.
   */
  webSocketFactory?: WebSocketFactory;

  /**
   * Override the base URL. Useful for self-hosted Deepgram or test
   * fixtures. Default: `wss://api.deepgram.com/v1/listen`.
   */
  baseUrl?: string;

  /**
   * Deepgram model name. Default: `nova-2`. Story 2.1 only mandates the
   * default; Story 2.5's engine router may override this per corridor.
   */
  model?: string;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
  detected_language?: string;
  language_confidence?: number;
}

interface DeepgramResultPayload {
  channel: DeepgramChannel;
  is_final: boolean;
  duration: number;
  speech_final?: boolean;
}

interface DeepgramMessage {
  type: 'Results' | 'Metadata' | 'SpeechStarted' | 'UtteranceEnd' | 'Error' | string;
  channel?: DeepgramChannel;
  is_final?: boolean;
  duration?: number;
  speech_final?: boolean;
  message?: string;
  err_code?: string;
}

/**
 * `WebSocket.readyState` values, kept as constants so we don't depend on
 * the global being available at module load time (it may not be in the
 * test environment).
 */
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

function defaultWebSocketFactory(): WebSocketFactory {
  return (url: string, opts: { authToken: string }): WebSocketLike => {
    if (typeof WebSocket === 'undefined') {
      throw new Error(
        'No global WebSocket available. Pass `webSocketFactory` to DeepgramProvider when running in a non-browser/non-RN environment.',
      );
    }
    // RN does not accept a `headers` arg on WebSocket; the proxy that the
    // app's auth layer builds embeds the token in the URL via a signed
    // short-TTL ticket. For now in the default factory we follow
    // browsers/RN: append `?token=` style. Production replaces this.
    const u = new URL(url);
    u.searchParams.set('token', opts.authToken);
    return new WebSocket(u.toString()) as unknown as WebSocketLike;
  };
}

export class DeepgramProvider implements SttProvider {
  readonly engine = 'deepgram' as const;

  private readonly apiToken: string;
  private readonly factory: WebSocketFactory;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: DeepgramProviderOptions) {
    if (!opts.apiToken) {
      throw new Error('DeepgramProvider: apiToken is required.');
    }
    this.apiToken = opts.apiToken;
    this.factory = opts.webSocketFactory ?? defaultWebSocketFactory();
    this.baseUrl = opts.baseUrl ?? 'wss://api.deepgram.com/v1/listen';
    this.model = opts.model ?? 'nova-2';
  }

  async start(opts: SttStartOptions): Promise<SttSession> {
    const url = this.buildUrl(opts);
    const ws = this.factory(url, { authToken: this.apiToken });
    const session = new DeepgramSession(ws, opts);

    if (opts.autoLanguageDetect === true) {
      session.emitImmediate({
        type: 'error',
        code: 'unsupported-language',
        message:
          "Deepgram's streaming API does not support automatic language detection; falling back to the explicit language hint. Route auto-detect requests to Google or Whisper instead.",
      });
    }

    if (opts.signal !== undefined) {
      const onAbort = (): void => {
        session.cancel('Aborted by caller.');
      };
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    await session.waitForOpen();
    return session;
  }

  private buildUrl(opts: SttStartOptions): string {
    const params = new URLSearchParams({
      model: this.model,
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: opts.interimResults === false ? 'false' : 'true',
      smart_format: 'true',
      language: opts.lang,
    });
    return `${this.baseUrl}?${params.toString()}`;
  }
}

class DeepgramSession implements SttSession {
  readonly engine = 'deepgram' as const;

  private readonly ws: WebSocketLike;
  private readonly listeners = new Set<SttEventListener>();
  private readonly openPromise: Promise<void>;
  private resolveOpen: (() => void) | null = null;
  private rejectOpen: ((err: Error) => void) | null = null;
  private endResolved = false;
  private endResolve: (() => void) | null = null;
  private endPromise: Promise<void> | null = null;
  private ended = false;
  private closed = false;
  private pendingEarlyEvents: SttEvent[] = [];

  constructor(
    ws: WebSocketLike,
    private readonly opts: SttStartOptions,
  ) {
    this.ws = ws;
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    this.attach();
  }

  on(listener: SttEventListener): () => void {
    this.listeners.add(listener);
    // Replay early events that arrived before any listener was attached.
    if (this.pendingEarlyEvents.length > 0) {
      const queued = this.pendingEarlyEvents;
      this.pendingEarlyEvents = [];
      for (const ev of queued) {
        listener(ev);
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(chunk: AudioChunk): void {
    if (this.ended || this.closed) {
      throw new Error('DeepgramSession: send() after end() / closed.');
    }
    if (this.ws.readyState !== WS_OPEN) {
      // Buffer / drop policy: silently drop. The pipeline can produce a
      // chunk in the small window between socket open notification and
      // wire-level open; in practice this is bounded to ≤1 chunk.
      return;
    }
    const buf = pcmBuffer(chunk);
    this.ws.send(buf);
  }

  async end(): Promise<void> {
    if (this.ended) {
      return this.endPromise ?? Promise.resolve();
    }
    this.ended = true;
    this.endPromise = new Promise<void>((resolve) => {
      this.endResolve = resolve;
    });
    if (this.ws.readyState === WS_OPEN) {
      // Deepgram's "CloseStream" sentinel — flushes buffered audio and
      // closes the socket cleanly so we receive any final transcripts.
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
    } else if (this.ws.readyState === WS_CLOSED || this.ws.readyState === WS_CLOSING) {
      this.resolveEnd();
    }
    return this.endPromise;
  }

  /**
   * Cancel the session immediately. Emits an `error{code:'cancelled'}`
   * followed by `closed`.
   */
  cancel(reason: string): void {
    if (this.closed) return;
    this.emit({ type: 'error', code: 'cancelled', message: reason });
    try {
      this.ws.close(1000, 'cancelled');
    } catch {
      // ignore — close errors are not actionable.
    }
  }

  /**
   * Used by the provider to inject events that occurred before the
   * session was returned to the caller (e.g. an unsupported-options
   * warning). Buffered until a listener attaches.
   */
  emitImmediate(event: SttEvent): void {
    if (this.listeners.size === 0) {
      this.pendingEarlyEvents.push(event);
      return;
    }
    this.emit(event);
  }

  waitForOpen(): Promise<void> {
    return this.openPromise;
  }

  private attach(): void {
    this.ws.addEventListener('open', () => {
      this.resolveOpen?.();
      this.resolveOpen = null;
      this.rejectOpen = null;
    });
    this.ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return; // ignore binary echo
      this.handleMessage(ev.data);
    });
    this.ws.addEventListener('error', () => {
      this.emit({
        type: 'error',
        code: 'network',
        message: 'WebSocket error from Deepgram.',
      });
      // The 'close' event will follow.
    });
    this.ws.addEventListener('close', (ev) => {
      if (this.resolveOpen !== null) {
        // Closed before the open handshake completed.
        this.rejectOpen?.(new Error(`Deepgram WebSocket closed before open: ${ev.code} ${ev.reason}`));
        this.resolveOpen = null;
        this.rejectOpen = null;
      }
      this.closed = true;
      this.emit({ type: 'closed' });
      this.resolveEnd();
    });
  }

  private handleMessage(raw: string): void {
    let msg: DeepgramMessage;
    try {
      msg = JSON.parse(raw) as DeepgramMessage;
    } catch {
      return;
    }
    if (msg.type === 'Error') {
      this.emit({
        type: 'error',
        code: deepgramCodeToStt(msg.err_code),
        message: msg.message ?? 'Deepgram error.',
      });
      return;
    }
    if (msg.type !== 'Results' && msg.channel === undefined) return;
    const payload: DeepgramResultPayload | undefined = msg.channel
      ? {
          channel: msg.channel,
          is_final: msg.is_final ?? false,
          duration: msg.duration ?? 0,
          speech_final: msg.speech_final,
        }
      : undefined;
    if (payload === undefined) return;
    const alt = payload.channel.alternatives[0];
    if (alt === undefined) return;
    const transcript = alt.transcript;
    if (transcript.length === 0) return;
    if (
      payload.channel.detected_language !== undefined &&
      payload.channel.language_confidence !== undefined
    ) {
      this.emit({
        type: 'language-detected',
        lang: payload.channel.detected_language,
        confidence: payload.channel.language_confidence,
      });
    }
    if (payload.is_final) {
      this.emit({
        type: 'final',
        transcript,
        confidence: alt.confidence,
        lang: this.opts.lang,
      });
    } else {
      this.emit({
        type: 'partial',
        transcript,
        confidence: alt.confidence,
        lang: this.opts.lang,
      });
    }
  }

  private emit(ev: SttEvent): void {
    if (this.listeners.size === 0) {
      this.pendingEarlyEvents.push(ev);
      return;
    }
    for (const l of this.listeners) {
      l(ev);
    }
  }

  private resolveEnd(): void {
    if (!this.endResolved) {
      this.endResolved = true;
      this.endResolve?.();
      this.endResolve = null;
    }
  }
}

function pcmBuffer(chunk: AudioChunk): ArrayBuffer {
  const samples = chunk.samples;
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    // Little-endian int16; Deepgram expects this for `linear16`.
    view.setInt16(i * 2, samples[i] ?? 0, true);
  }
  return buf;
}

function deepgramCodeToStt(code: string | undefined): import('./stt-types').SttErrorCode {
  if (code === undefined) return 'engine';
  if (code.startsWith('AUTH') || code === 'INVALID_AUTH') return 'auth';
  if (code === 'RATE_LIMITED' || code === 'TOO_MANY_REQUESTS') return 'rate-limited';
  if (code === 'NOT_SUPPORTED' || code === 'UNSUPPORTED_LANGUAGE') return 'unsupported-language';
  if (code === 'INVALID_AUDIO' || code === 'BAD_REQUEST') return 'invalid-audio';
  return 'engine';
}
