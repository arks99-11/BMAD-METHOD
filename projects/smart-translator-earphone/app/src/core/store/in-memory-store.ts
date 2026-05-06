/**
 * Story 7.1 — In-memory implementation of `LocalStore`.
 *
 * Used by the rest of the app's unit tests so they don't have to spin
 * up SQLite. Search uses a simple substring + token scoring algorithm
 * that approximates FTS5's BM25 well enough for tests; the production
 * SQLite store will use real FTS5 ranking.
 */

import type {
  LanguagePackRecord,
  LocalStore,
  MessageRecord,
  MessageSearchHit,
  MessageSearchQuery,
  SessionListQuery,
  SessionRecord,
  SettingsRecord,
} from './store-types';

export class InMemoryStore implements LocalStore {
  private sessions = new Map<string, SessionRecord>();
  private messagesBySession = new Map<string, MessageRecord[]>();
  private packs = new Map<string, LanguagePackRecord>();
  private settings = new Map<string, string>();
  private initialised = false;

  async init(): Promise<void> {
    this.initialised = true;
  }

  // --- Sessions ---
  async insertSession(s: SessionRecord): Promise<void> {
    this.assertInit();
    this.sessions.set(s.id, { ...s });
  }

  async updateSession(s: SessionRecord): Promise<void> {
    this.assertInit();
    if (!this.sessions.has(s.id)) {
      throw new Error(`InMemoryStore: session ${s.id} not found.`);
    }
    this.sessions.set(s.id, { ...s });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    this.assertInit();
    const s = this.sessions.get(id);
    return s === undefined ? undefined : { ...s };
  }

  async listSessions(q: SessionListQuery = {}): Promise<SessionRecord[]> {
    this.assertInit();
    let rows = [...this.sessions.values()];
    if (q.mode !== undefined) {
      rows = rows.filter((r) => r.mode === q.mode);
    }
    if (q.language !== undefined) {
      const lang = q.language;
      rows = rows.filter((r) => r.sourceLang === lang || r.targetLang === lang);
    }
    rows.sort((a, b) => b.startedAt - a.startedAt);
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 50;
    return rows.slice(offset, offset + limit).map((r) => ({ ...r }));
  }

  async deleteSession(id: string): Promise<void> {
    this.assertInit();
    this.sessions.delete(id);
    this.messagesBySession.delete(id);
  }

  // --- Messages ---
  async insertMessage(m: MessageRecord): Promise<void> {
    this.assertInit();
    let bucket = this.messagesBySession.get(m.sessionId);
    if (bucket === undefined) {
      bucket = [];
      this.messagesBySession.set(m.sessionId, bucket);
    }
    bucket.push({ ...m });
  }

  async updateMessage(m: MessageRecord): Promise<void> {
    this.assertInit();
    const bucket = this.messagesBySession.get(m.sessionId);
    if (bucket === undefined) return;
    const idx = bucket.findIndex((x) => x.id === m.id);
    if (idx === -1) return;
    bucket[idx] = { ...m };
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    this.assertInit();
    return [...(this.messagesBySession.get(sessionId) ?? [])].map((m) => ({ ...m }));
  }

  async searchMessages(q: MessageSearchQuery): Promise<MessageSearchHit[]> {
    this.assertInit();
    const tokens = q.text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    const hits: MessageSearchHit[] = [];
    for (const [sessionId, bucket] of this.messagesBySession) {
      const session = this.sessions.get(sessionId);
      if (session === undefined) continue;
      if (q.mode !== undefined && session.mode !== q.mode) continue;
      if (q.language !== undefined) {
        if (session.sourceLang !== q.language && session.targetLang !== q.language) continue;
      }
      for (const m of bucket) {
        const lower = m.text.toLowerCase();
        let rank = 0;
        for (const tok of tokens) {
          const idx = lower.indexOf(tok);
          if (idx === -1) {
            rank = -1;
            break;
          }
          rank += 1;
          // Bonus for prefix match.
          if (idx === 0 || lower[idx - 1] === ' ') rank += 0.5;
        }
        if (rank > 0) {
          hits.push({
            message: { ...m },
            session: { ...session },
            rank,
            snippet: makeSnippet(m.text, tokens),
          });
        }
      }
    }
    hits.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 50;
    return hits.slice(offset, offset + limit);
  }

  // --- Language packs ---
  async upsertLanguagePack(p: LanguagePackRecord): Promise<void> {
    this.assertInit();
    this.packs.set(p.id, { ...p });
  }

  async listLanguagePacks(): Promise<LanguagePackRecord[]> {
    this.assertInit();
    return [...this.packs.values()].map((p) => ({ ...p }));
  }

  async removeLanguagePack(id: string): Promise<void> {
    this.assertInit();
    this.packs.delete(id);
  }

  // --- Settings ---
  async setSetting(key: string, value: string): Promise<void> {
    this.assertInit();
    this.settings.set(key, value);
  }

  async getSetting(key: string): Promise<string | undefined> {
    this.assertInit();
    return this.settings.get(key);
  }

  async listSettings(): Promise<SettingsRecord[]> {
    this.assertInit();
    return [...this.settings.entries()].map(([key, value]) => ({ key, value }));
  }

  private assertInit(): void {
    if (!this.initialised) {
      throw new Error('InMemoryStore: init() must be called before use.');
    }
  }
}

function makeSnippet(text: string, tokens: readonly string[]): string {
  let out = text;
  for (const tok of tokens) {
    const re = new RegExp(`(${escapeRegex(tok)})`, 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
