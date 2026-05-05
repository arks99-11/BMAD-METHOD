/**
 * Epic 11 — Minimal Cloudflare Workers / Durable Objects type shims.
 *
 * The full ambient types live in `@cloudflare/workers-types`, but
 * pulling that in creates a hard dependency that the rest of the
 * app (React Native runtime) can't satisfy. Instead we define a
 * minimal structural subset here so the relay / store / ingest
 * code compiles in this repo's strict-TS Jest environment without
 * pulling new ambient typings.
 *
 * The actual Worker entry point (`worker.ts`) — when added during
 * deployment — re-types its `env` against the real Cloudflare ambient
 * declarations. This file exists to make the server logic
 * *structurally* compatible without needing a build-time dependency.
 */

/** A Cloudflare KV namespace (subset we use). */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  get(key: string, type: 'json'): Promise<unknown | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** Subset of the Durable Object state surface we use. */
export interface DurableObjectState {
  storage: DurableObjectStorage;
  id: { toString(): string };
}

export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

/** Minimal WebSocket subset matching the Workers WebSocketPair. */
export interface WorkerWebSocket {
  readonly readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  accept(): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: string | ArrayBuffer }) => void,
  ): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}

export const WORKER_WS_OPEN = 1;
export const WORKER_WS_CLOSED = 3;
