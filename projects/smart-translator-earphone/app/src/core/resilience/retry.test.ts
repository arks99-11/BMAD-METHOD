import { withRetry } from './retry';

describe('withRetry', () => {
  it('returns the result on first success', async () => {
    const out = await withRetry(async () => 42);
    expect(out).toBe(42);
  });

  it('retries up to maxAttempts and returns the final result', async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('flake');
        return 'ok';
      },
      {
        maxAttempts: 5,
        baseDelayMs: 0,
        maxDelayMs: 0,
        random: () => 0,
      },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws after maxAttempts of failure', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('always');
        },
        { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, random: () => 0 },
      ),
    ).rejects.toThrow('always');
    expect(calls).toBe(3);
  });

  it('honours shouldRetry=false to short-circuit', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('fatal');
        },
        {
          maxAttempts: 5,
          baseDelayMs: 0,
          shouldRetry: () => false,
          random: () => 0,
        },
      ),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });

  it('does not retry aborted operations by default', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('aborted: user cancelled');
        },
        { maxAttempts: 5, baseDelayMs: 0, random: () => 0 },
      ),
    ).rejects.toThrow('aborted');
    expect(calls).toBe(1);
  });

  it('throws when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withRetry(async () => 1, { signal: controller.signal }),
    ).rejects.toThrow('aborted');
  });
});
