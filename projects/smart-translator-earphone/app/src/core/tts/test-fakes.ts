/**
 * TTS-specific test fakes — chiefly a `FakeStreamingFetcher` that
 * produces a streaming `Response` whose body emits a sequence of
 * Uint8Array chunks. The shared `FakeFetcher` in `core/stt/test-fakes`
 * returns single-shot bodies (good for STT REST), so we have a
 * separate helper here for TTS streaming.
 */

export interface FakeStreamingResponse {
  status?: number;
  headers?: Record<string, string>;
  /** Chunks delivered via the streaming body. */
  chunks?: Array<Uint8Array | string>;
  /** Override body text for non-2xx responses. */
  bodyText?: string;
  /** Optional delay before sending each chunk, in ms. */
  chunkDelayMs?: number;
}

export interface FakeStreamingRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export class FakeStreamingFetcher {
  readonly requests: FakeStreamingRequest[] = [];
  private readonly queue: FakeStreamingResponse[];

  constructor(responses: FakeStreamingResponse[]) {
    this.queue = [...responses];
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    this.requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: normalizeHeaders(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error('FakeStreamingFetcher: no queued response.');
    }
    const status = next.status ?? 200;
    if (status >= 400) {
      return new Response(next.bodyText ?? '', { status });
    }
    const chunks = next.chunks ?? [];
    const delay = next.chunkDelayMs ?? 0;
    const body = new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> {
        for (const c of chunks) {
          if (delay > 0) {
            await new Promise((r) => setTimeout(r, delay));
          }
          controller.enqueue(typeof c === 'string' ? new TextEncoder().encode(c) : c);
        }
        controller.close();
      },
    });
    return new Response(body, { status, headers: next.headers });
  };
}

function normalizeHeaders(input: HeadersInit | undefined): Record<string, string> {
  if (input === undefined) return {};
  if (input instanceof Headers) {
    const out: Record<string, string> = {};
    input.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(input)) {
    const out: Record<string, string> = {};
    for (const [k, v] of input) {
      out[k.toLowerCase()] = v;
    }
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

export function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}
