/**
 * Epic 11 — SessionStore tests.
 */

import { InMemoryKv, SessionStore } from './session-store';

describe('InMemoryKv', () => {
  it('round-trips put/get', async () => {
    const kv = new InMemoryKv();
    await kv.put('a', 'hi');
    expect(await kv.get('a')).toBe('hi');
  });

  it('returns null for missing keys', async () => {
    const kv = new InMemoryKv();
    expect(await kv.get('missing')).toBeNull();
  });

  it('expires entries past their TTL', async () => {
    let now = 1000;
    const kv = new InMemoryKv(() => now);
    await kv.put('a', 'hi', { expirationTtl: 10 });
    expect(await kv.get('a')).toBe('hi');
    now = 1000 + 11_000;
    expect(await kv.get('a')).toBeNull();
  });

  it("get(key, 'json') parses JSON", async () => {
    const kv = new InMemoryKv();
    await kv.put('a', JSON.stringify({ x: 1 }));
    expect(await kv.get('a', 'json')).toEqual({ x: 1 });
  });

  it("get(key, 'json') returns null on bad JSON", async () => {
    const kv = new InMemoryKv();
    await kv.put('a', '{not json');
    expect(await kv.get('a', 'json')).toBeNull();
  });

  it('list() with prefix omits expired entries', async () => {
    let now = 0;
    const kv = new InMemoryKv(() => now);
    await kv.put('p:a', '1');
    await kv.put('p:b', '2', { expirationTtl: 1 });
    await kv.put('q:c', '3');
    now = 5_000;
    const result = await kv.list({ prefix: 'p:' });
    expect(result.keys.map((k) => k.name).sort()).toEqual(['p:a']);
  });
});

describe('SessionStore', () => {
  it('claimToken stores and resolves', async () => {
    const store = new SessionStore({ kv: new InMemoryKv() });
    const ok = await store.claimToken('ABCDEF', {
      sessionId: 's1',
      hostLang: 'EN',
      createdAt: 0,
    });
    expect(ok).toBe(true);
    const rec = await store.resolveToken('ABCDEF');
    expect(rec?.sessionId).toBe('s1');
  });

  it('claimToken returns false on collision', async () => {
    const store = new SessionStore({ kv: new InMemoryKv() });
    await store.claimToken('ABCDEF', {
      sessionId: 's1',
      hostLang: 'EN',
      createdAt: 0,
    });
    const second = await store.claimToken('ABCDEF', {
      sessionId: 's2',
      hostLang: 'EN',
      createdAt: 1,
    });
    expect(second).toBe(false);
  });

  it('claimToken rejects malformed tokens', async () => {
    const store = new SessionStore({ kv: new InMemoryKv() });
    await expect(
      store.claimToken('bad-token!', {
        sessionId: 's',
        hostLang: 'EN',
        createdAt: 0,
      }),
    ).rejects.toThrow();
  });

  it('claimToken normalises case', async () => {
    const store = new SessionStore({ kv: new InMemoryKv() });
    await store.claimToken('abcdef', {
      sessionId: 's',
      hostLang: 'EN',
      createdAt: 0,
    });
    expect(await store.resolveToken('ABCDEF')).toBeDefined();
  });

  it('resolveToken returns undefined for malformed tokens', async () => {
    const store = new SessionStore({ kv: new InMemoryKv() });
    expect(await store.resolveToken('not!')).toBeUndefined();
  });

  it('resolveToken returns undefined for missing tokens', async () => {
    const store = new SessionStore({ kv: new InMemoryKv() });
    expect(await store.resolveToken('ABCDEF')).toBeUndefined();
  });

  it('releaseToken drops the mapping', async () => {
    const store = new SessionStore({ kv: new InMemoryKv() });
    await store.claimToken('ABCDEF', {
      sessionId: 's',
      hostLang: 'EN',
      createdAt: 0,
    });
    await store.releaseToken('ABCDEF');
    expect(await store.resolveToken('ABCDEF')).toBeUndefined();
  });

  it('expires past the TTL', async () => {
    let now = 0;
    const kv = new InMemoryKv(() => now);
    const store = new SessionStore({ kv, ttlSeconds: 5, now: () => now });
    await store.claimToken('ABCDEF', {
      sessionId: 's',
      hostLang: 'EN',
      createdAt: 0,
    });
    now = 10_000;
    expect(await store.resolveToken('ABCDEF')).toBeUndefined();
  });

  it('resolveToken returns undefined for corrupt JSON', async () => {
    const kv = new InMemoryKv();
    await kv.put('invite:ABCDEF', '{not json');
    const store = new SessionStore({ kv });
    expect(await store.resolveToken('ABCDEF')).toBeUndefined();
  });
});
