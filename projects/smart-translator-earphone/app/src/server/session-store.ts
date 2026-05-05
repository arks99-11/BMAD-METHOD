/**
 * Epic 11 — Token-to-session-id mapping backed by Cloudflare KV.
 *
 * The 6-character invite token (Story 9.1) is the user-facing
 * shareable code; the session id is the Durable Object id used
 * internally for the relay channel. The mapping has a default TTL
 * (24h) so abandoned tokens self-clean.
 *
 * `claimToken` is the host's open call: write the mapping iff the
 * token is free. The KV `put` is non-atomic, so we do a read-then-
 * write-with-conditional-fail loop (limited retries), which is
 * good enough given the 24^6 token space and the relay being the
 * source of truth.
 *
 * Tests use `InMemoryKv` (also in this file) so the suite never
 * requires a real KV namespace.
 */

import { isValidInviteToken, normaliseInviteToken } from '../core/group/invite-token';
import type { KVNamespace } from './cloudflare-types';

export interface TokenRecord {
  sessionId: string;
  hostLang: string;
  /** ms epoch when the host opened this token. */
  createdAt: number;
}

export interface SessionStoreOptions {
  kv: KVNamespace;
  /** TTL in seconds; defaults to 24h. */
  ttlSeconds?: number;
  /** Wall clock; injectable for tests. */
  now?: () => number;
}

const KEY_PREFIX = 'invite:';

export class SessionStore {
  private readonly kv: KVNamespace;
  private readonly ttlSeconds: number;
  private readonly now: () => number;

  constructor(opts: SessionStoreOptions) {
    this.kv = opts.kv;
    this.ttlSeconds = opts.ttlSeconds ?? 24 * 60 * 60;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Reserve a token for the given session id. Returns false if the
   * token is already in use. No exceptions for collision; callers
   * can request a fresh token and retry.
   */
  async claimToken(token: string, record: TokenRecord): Promise<boolean> {
    const norm = normaliseInviteToken(token);
    if (!isValidInviteToken(norm)) {
      throw new Error(`SessionStore.claimToken: invalid token '${token}'`);
    }
    const existing = await this.kv.get(KEY_PREFIX + norm);
    if (existing !== null) return false;
    await this.kv.put(KEY_PREFIX + norm, JSON.stringify(record), {
      expirationTtl: this.ttlSeconds,
    });
    return true;
  }

  /** Look up a token. Returns undefined if missing or malformed. */
  async resolveToken(token: string): Promise<TokenRecord | undefined> {
    const norm = normaliseInviteToken(token);
    if (!isValidInviteToken(norm)) return undefined;
    const raw = await this.kv.get(KEY_PREFIX + norm);
    if (raw === null) return undefined;
    try {
      const parsed = JSON.parse(raw) as TokenRecord;
      if (typeof parsed.sessionId !== 'string') return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  /** Release a token (host explicitly ends the session). */
  async releaseToken(token: string): Promise<void> {
    const norm = normaliseInviteToken(token);
    if (!isValidInviteToken(norm)) return;
    await this.kv.delete(KEY_PREFIX + norm);
  }

  /** Useful in tests + for `/admin` debug endpoints. */
  getNow(): number {
    return this.now();
  }
}

/**
 * In-memory KV implementation suitable for unit tests. NOT for
 * production use; it's a Map and forgets state on process exit.
 */
export class InMemoryKv implements KVNamespace {
  private readonly store = new Map<string, { value: string; expiresAt?: number }>();
  /** Wall clock; injectable for tests. */
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async get(key: string): Promise<string | null>;
  async get(key: string, type: 'json'): Promise<unknown | null>;
  async get(key: string, type?: 'json'): Promise<string | unknown | null> {
    const entry = this.store.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    if (type === 'json') {
      try {
        return JSON.parse(entry.value) as unknown;
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    const entry: { value: string; expiresAt?: number } = { value };
    if (options?.expirationTtl !== undefined) {
      entry.expiresAt = this.now() + options.expirationTtl * 1000;
    }
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix ?? '';
    const keys: Array<{ name: string; expiration?: number; metadata?: unknown }> = [];
    for (const [name, entry] of this.store.entries()) {
      if (!name.startsWith(prefix)) continue;
      if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) continue;
      const k: { name: string; expiration?: number; metadata?: unknown } = { name };
      if (entry.expiresAt !== undefined) {
        k.expiration = Math.floor(entry.expiresAt / 1000);
      }
      keys.push(k);
    }
    return { keys, list_complete: true };
  }
}
