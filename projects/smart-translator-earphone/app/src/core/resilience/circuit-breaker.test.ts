import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts closed', () => {
    const cb = new CircuitBreaker();
    expect(cb.current()).toBe('closed');
    expect(cb.isOpen()).toBe(false);
  });

  it('opens after failureThreshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure(new Error('x'));
    cb.recordFailure(new Error('x'));
    expect(cb.current()).toBe('closed');
    cb.recordFailure(new Error('x'));
    expect(cb.current()).toBe('open');
    expect(cb.isOpen()).toBe(true);
  });

  it('successes reset the failure count', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure(new Error('x'));
    cb.recordFailure(new Error('x'));
    cb.recordSuccess();
    cb.recordFailure(new Error('x'));
    cb.recordFailure(new Error('x'));
    expect(cb.current()).toBe('closed');
  });

  it('moves to half-open after cooldown', () => {
    let now = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
    });
    cb.recordFailure(new Error('x'));
    expect(cb.isOpen()).toBe(true);
    now = 200;
    expect(cb.isOpen()).toBe(false);
    expect(cb.current()).toBe('half-open');
  });

  it('half-open + failure reopens for another cooldown', () => {
    let now = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
    });
    cb.recordFailure(new Error('x'));
    now = 200;
    cb.current(); // forces transition to half-open
    cb.recordFailure(new Error('x'));
    expect(cb.current()).toBe('open');
    expect(cb.isOpen()).toBe(true);
  });

  it('half-open + success closes the breaker', () => {
    let now = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
    });
    cb.recordFailure(new Error('x'));
    now = 200;
    cb.current();
    cb.recordSuccess();
    expect(cb.current()).toBe('closed');
  });

  it('wrap() short-circuits when open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000 });
    cb.recordFailure(new Error('boom'));
    await expect(cb.wrap(async () => 1)).rejects.toThrow('boom');
  });

  it('wrap() runs and records success', async () => {
    const cb = new CircuitBreaker();
    const v = await cb.wrap(async () => 99);
    expect(v).toBe(99);
    expect(cb.current()).toBe('closed');
  });

  it('reset() forces back to closed', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure(new Error('x'));
    cb.reset();
    expect(cb.current()).toBe('closed');
    expect(cb.isOpen()).toBe(false);
  });
});
