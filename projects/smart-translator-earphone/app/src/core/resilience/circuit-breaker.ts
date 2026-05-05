/**
 * Story 10.4 — Circuit breaker for vendor adapters.
 *
 * Tracks consecutive failures per resource. After `failureThreshold`
 * failures in a row, the breaker opens for `cooldownMs` and any
 * `wrap()` call short-circuits with the captured error. After the
 * cooldown elapses, the breaker enters half-open and lets a single
 * call through; success closes the breaker, failure reopens it for
 * another `cooldownMs`.
 *
 * The engine router consults the breaker via `isOpen(engine)` to
 * fall through to the next corridor if a vendor is misbehaving.
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  /** Wall clock; injectable for tests. */
  now?: () => number;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private lastError: Error | undefined;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  isOpen(): boolean {
    if (this.state === 'open') {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  current(): BreakerState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  async wrap<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw this.lastError ?? new Error('circuit-open');
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastError = undefined;
  }

  recordFailure(err: unknown): void {
    this.lastError = err instanceof Error ? err : new Error(String(err));
    if (this.state === 'half-open') {
      this.openCircuit();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openCircuit();
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = 0;
    this.lastError = undefined;
  }

  private openCircuit(): void {
    this.state = 'open';
    this.openedAt = this.now();
  }
}
