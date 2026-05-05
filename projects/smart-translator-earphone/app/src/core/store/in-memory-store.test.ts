/**
 * Story 7.1 — InMemoryStore tests.
 */

import { InMemoryStore } from './in-memory-store';
import type { MessageRecord, SessionRecord } from './store-types';

function makeSession(id: string, mode: 'conversation' | 'lecture' = 'conversation', startedAt = 0): SessionRecord {
  return {
    id,
    mode,
    sourceLang: 'EN',
    targetLang: 'ES',
    startedAt,
    turnCount: 0,
  };
}

function makeMessage(
  id: string,
  sessionId: string,
  side: 'source' | 'target',
  text: string,
  ts = 0,
): MessageRecord {
  return {
    id,
    sessionId,
    turnId: `turn-${id}`,
    side,
    lang: side === 'source' ? 'EN' : 'ES',
    text,
    isFinal: true,
    ts,
  };
}

describe('InMemoryStore', () => {
  it('throws if used before init', async () => {
    const store = new InMemoryStore();
    await expect(store.insertSession(makeSession('a'))).rejects.toThrow(/init/);
  });

  it('inserts and reads sessions back', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('s1'));
    const r = await store.getSession('s1');
    expect(r?.id).toBe('s1');
  });

  it('updates an existing session', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('s1'));
    await store.updateSession({ ...makeSession('s1'), title: 'Renamed' });
    const r = await store.getSession('s1');
    expect(r?.title).toBe('Renamed');
  });

  it('rejects update on missing session', async () => {
    const store = new InMemoryStore();
    await store.init();
    await expect(store.updateSession(makeSession('missing'))).rejects.toThrow(/not found/);
  });

  it('listSessions sorts newest first', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('a', 'conversation', 100));
    await store.insertSession(makeSession('b', 'conversation', 200));
    await store.insertSession(makeSession('c', 'conversation', 50));
    const rows = await store.listSessions();
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('listSessions filters by mode', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('a', 'conversation', 1));
    await store.insertSession(makeSession('b', 'lecture', 2));
    const rows = await store.listSessions({ mode: 'lecture' });
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('paginates listSessions', async () => {
    const store = new InMemoryStore();
    await store.init();
    for (let i = 0; i < 5; i += 1) {
      await store.insertSession(makeSession(`s${i}`, 'conversation', i));
    }
    const page1 = await store.listSessions({ offset: 0, limit: 2 });
    const page2 = await store.listSessions({ offset: 2, limit: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
  });

  it('inserts and lists messages by session', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('s'));
    await store.insertMessage(makeMessage('m1', 's', 'source', 'hello world'));
    await store.insertMessage(makeMessage('m2', 's', 'target', 'hola mundo'));
    const msgs = await store.listMessages('s');
    expect(msgs).toHaveLength(2);
  });

  it('searchMessages finds substring matches', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('s'));
    await store.insertMessage(makeMessage('m1', 's', 'source', 'the quick brown fox'));
    await store.insertMessage(makeMessage('m2', 's', 'source', 'jumps over the lazy dog'));
    const hits = await store.searchMessages({ text: 'quick' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message.id).toBe('m1');
    expect(hits[0]!.snippet).toContain('<mark>quick</mark>');
  });

  it('searchMessages requires all tokens to match', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('s'));
    await store.insertMessage(makeMessage('m1', 's', 'source', 'the quick brown fox'));
    await store.insertMessage(makeMessage('m2', 's', 'source', 'a slow brown bear'));
    const hits = await store.searchMessages({ text: 'quick brown' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message.id).toBe('m1');
  });

  it('searchMessages filters by mode and language', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession({ ...makeSession('a', 'conversation'), sourceLang: 'EN', targetLang: 'ES' });
    await store.insertSession({ ...makeSession('b', 'lecture'), sourceLang: 'EN', targetLang: 'DE' });
    await store.insertMessage(makeMessage('m1', 'a', 'source', 'hello'));
    await store.insertMessage(makeMessage('m2', 'b', 'source', 'hello'));
    const lectureOnly = await store.searchMessages({ text: 'hello', mode: 'lecture' });
    expect(lectureOnly.map((h) => h.session.id)).toEqual(['b']);
    const esOnly = await store.searchMessages({ text: 'hello', language: 'ES' });
    expect(esOnly.map((h) => h.session.id)).toEqual(['a']);
  });

  it('searchMessages returns empty for empty / whitespace query', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('s'));
    await store.insertMessage(makeMessage('m1', 's', 'source', 'hello'));
    expect(await store.searchMessages({ text: '' })).toEqual([]);
    expect(await store.searchMessages({ text: '   ' })).toEqual([]);
  });

  it('deleteSession drops session and its messages', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession(makeSession('s'));
    await store.insertMessage(makeMessage('m1', 's', 'source', 'hello'));
    await store.deleteSession('s');
    expect(await store.getSession('s')).toBeUndefined();
    expect(await store.listMessages('s')).toEqual([]);
  });

  it('upserts and lists language packs', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.upsertLanguagePack({
      id: 'en-tiny',
      lang: 'EN',
      version: '1.0',
      sizeBytes: 100,
      downloadedAt: 0,
    });
    expect(await store.listLanguagePacks()).toHaveLength(1);
    await store.removeLanguagePack('en-tiny');
    expect(await store.listLanguagePacks()).toHaveLength(0);
  });

  it('persists settings through getSetting / setSetting', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.setSetting('foo', 'bar');
    expect(await store.getSetting('foo')).toBe('bar');
    expect(await store.listSettings()).toEqual([{ key: 'foo', value: 'bar' }]);
  });
});
