/**
 * Story 10.4 — Network-resilience retry helper.
 *
 * Exponential backoff with jitter, capped at `maxAttempts` and
 * `maxDelayMs`. Cooperatively cancellable via an AbortSignal.
 *
 * Used by HTTP-based providers (Deepgram polling, Google STT REST,
 * DeepL REST, Google MT REST, Azure TTS REST) when the failure
 * mode is transient (network, 429, 5xx).
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 0..1. Default 0.2 = ±20% jitter. */
  jitter?: number;
  /** Predicate: should this error be retried? Default: yes for any non-abort. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  signal?: AbortSignal;
  /** Wall-clock; injectable for tests. */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Random source for jitter. */
  random?: () => number;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const jitter = options.jitter ?? 0.2;
  const setTimeoutFn: (cb: () => void, ms: number) => unknown =
    options.setTimeoutFn ??
    ((cb: () => void, ms: number): unknown => globalThis.setTimeout(cb, ms));
  const clearTimeoutFn: (handle: unknown) => void =
    options.clearTimeoutFn ??
    ((handle: unknown): void => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    });
  const random = options.random ?? Math.random;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const signal = options.signal;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted === true) {
      throw new Error('aborted');
    }
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      if (!shouldRetry(err, attempt)) break;
      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const sign = random() < 0.5 ? -1 : 1;
      const noise = exp * jitter * random() * sign;
      const delay = Math.max(0, Math.floor(exp + noise));
      await sleep(delay, signal, setTimeoutFn, clearTimeoutFn);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof Error && /abort/i.test(err.message)) return false;
  return true;
}

function sleep(
  ms: number,
  signal: AbortSignal | undefined,
  setTimeoutFn: (cb: () => void, ms: number) => unknown,
  clearTimeoutFn: (handle: unknown) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('aborted'));
      return;
    }
    const handle = setTimeoutFn(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeoutFn(handle);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
