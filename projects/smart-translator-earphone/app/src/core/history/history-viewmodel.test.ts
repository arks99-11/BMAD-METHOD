/**
 * Story 7.2 — HistoryViewModel tests.
 */

import { InMemoryStore } from '../store/in-memory-store';
import type { MessageRecord, SessionRecord } from '../store/store-types';
import { HistoryViewModel } from './history-viewmodel';

function makeSession(id: string, startedAt = 0): SessionRecord {
  return {
    id,
    mode: 'conversation',
    sourceLang: 'EN',
    targetLang: 'ES',
    startedAt,
    turnCount: 1,
  };
}

function makeMessage(id: string, sessionId: string, text: string): MessageRecord {
  return {
    id,
    sessionId,
    turnId: `t-${id}`,
    side: 'source',
    lang: 'EN',
    text,
    isFinal: true,
    ts: 0,
  };
}

async function seed(store: InMemoryStore): Promise<void> {
  await store.init();
  for (let i = 0; i < 5; i += 1) {
    await store.insertSession(makeSession(`s${i}`, i * 10));
    await store.insertMessage(makeMessage(`m${i}`, `s${i}`, `hello session ${i}`));
  }
}

describe('HistoryViewModel', () => {
  it('refresh loads the first page of sessions', async () => {
    const store = new InMemoryStore();
    await seed(store);
    const vm = new HistoryViewModel({ store, pageSize: 3 });
    await vm.refresh();
    const s = vm.state();
    expect(s.sessions).toHaveLength(3);
    expect(s.endReached).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('nextPage appends until the end is reached', async () => {
    const store = new InMemoryStore();
    await seed(store);
    const vm = new HistoryViewModel({ store, pageSize: 3 });
    await vm.refresh();
    await vm.nextPage();
    const s = vm.state();
    expect(s.sessions).toHaveLength(5);
    expect(s.endReached).toBe(true);
  });

  it('nextPage is a no-op once endReached', async () => {
    const store = new InMemoryStore();
    await seed(store);
    const vm = new HistoryViewModel({ store, pageSize: 10 });
    await vm.refresh();
    expect(vm.state().endReached).toBe(true);
    await vm.nextPage();
    expect(vm.state().sessions).toHaveLength(5);
  });

  it('setQuery flips into search mode', async () => {
    const store = new InMemoryStore();
    await seed(store);
    const vm = new HistoryViewModel({ store, pageSize: 10 });
    await vm.setQuery('session 1');
    const s = vm.state();
    expect(s.query).toBe('session 1');
    expect(s.searchHits.length).toBeGreaterThan(0);
    expect(s.searchHits[0]!.snippet).toContain('<mark>');
  });

  it('setQuery to empty exits search mode', async () => {
    const store = new InMemoryStore();
    await seed(store);
    const vm = new HistoryViewModel({ store, pageSize: 10 });
    await vm.setQuery('session');
    expect(vm.state().searchHits.length).toBeGreaterThan(0);
    await vm.setQuery('');
    expect(vm.state().query).toBe('');
    expect(vm.state().searchHits).toEqual([]);
    expect(vm.state().sessions.length).toBeGreaterThan(0);
  });

  it('setFilter applies a mode filter', async () => {
    const store = new InMemoryStore();
    await store.init();
    await store.insertSession({ ...makeSession('a'), mode: 'conversation' });
    await store.insertSession({ ...makeSession('b'), mode: 'lecture' });
    const vm = new HistoryViewModel({ store, pageSize: 10 });
    await vm.setFilter({ mode: 'lecture' });
    expect(vm.state().sessions.map((s) => s.id)).toEqual(['b']);
  });

  it('captures error state on store failure', async () => {
    const store = new InMemoryStore();
    await store.init();
    const broken = {
      ...store,
      listSessions: async () => {
        throw new Error('boom');
      },
    } as unknown as InMemoryStore;
    const vm = new HistoryViewModel({ store: broken, pageSize: 10 });
    await vm.refresh();
    expect(vm.state().error?.code).toBe('load-failed');
    expect(vm.state().error?.message).toBe('boom');
  });

  it('emits state to subscribers', async () => {
    const store = new InMemoryStore();
    await seed(store);
    const vm = new HistoryViewModel({ store, pageSize: 10 });
    const states: number[] = [];
    vm.on((s) => states.push(s.sessions.length));
    await vm.refresh();
    expect(states.length).toBeGreaterThanOrEqual(2); // loading=true then loading=false
  });
});
