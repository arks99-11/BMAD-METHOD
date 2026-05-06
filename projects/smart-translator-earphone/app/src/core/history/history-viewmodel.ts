/**
 * Story 7.2 — History list view-model.
 *
 * Wraps `LocalStore.listSessions` and `LocalStore.searchMessages` for
 * the History tab (UX §3.6). Owns:
 *
 *  - The current filter (mode, language, free-text search query).
 *  - The current page of results.
 *  - The "loading" / "no-more" / "error" states for the UI.
 *
 * The view-model is the source of truth for the History screen's
 * displayed list. The screen subscribes via `on(listener)` and
 * issues commands (`setQuery`, `nextPage`, `refresh`).
 */

import type {
  LocalStore,
  MessageSearchHit,
  SessionListQuery,
  SessionMode,
  SessionRecord,
} from '../store/store-types';

export type HistoryFilter = {
  /** Conversation, lecture, or both. */
  mode?: SessionMode;
  /** ISO language code; matches either source or target. */
  language?: string;
};

export interface HistoryViewState {
  /** Free-text search query; when non-empty, the view shows search hits. */
  query: string;
  filter: HistoryFilter;
  loading: boolean;
  /**
   * When `query` is empty, the list is the session list; when set,
   * `searchHits` carries message-level results.
   */
  sessions: SessionRecord[];
  searchHits: MessageSearchHit[];
  /** True when the last fetch returned fewer rows than the page size. */
  endReached: boolean;
  /** Stable error code surfaced to the UI banner. */
  error?: { code: 'load-failed' | 'search-failed'; message: string };
}

export type HistoryListener = (state: HistoryViewState) => void;

export interface HistoryViewModelOptions {
  store: LocalStore;
  pageSize?: number;
}

export class HistoryViewModel {
  private readonly store: LocalStore;
  private readonly pageSize: number;
  private readonly listeners = new Set<HistoryListener>();

  private query = '';
  private filter: HistoryFilter = {};
  private sessions: SessionRecord[] = [];
  private searchHits: MessageSearchHit[] = [];
  private loading = false;
  private endReached = false;
  private error: HistoryViewState['error'] = undefined;
  private offset = 0;

  constructor(opts: HistoryViewModelOptions) {
    this.store = opts.store;
    this.pageSize = opts.pageSize ?? 50;
  }

  on(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  state(): HistoryViewState {
    const s: HistoryViewState = {
      query: this.query,
      filter: { ...this.filter },
      loading: this.loading,
      sessions: [...this.sessions],
      searchHits: [...this.searchHits],
      endReached: this.endReached,
    };
    if (this.error !== undefined) s.error = this.error;
    return s;
  }

  /** Apply a new filter and refresh the first page. */
  async setFilter(filter: HistoryFilter): Promise<void> {
    this.filter = { ...filter };
    await this.refresh();
  }

  /** Apply a new search query and refresh. Pass '' to exit search. */
  async setQuery(query: string): Promise<void> {
    this.query = query.trim();
    await this.refresh();
  }

  /** Reload the first page. */
  async refresh(): Promise<void> {
    this.offset = 0;
    this.sessions = [];
    this.searchHits = [];
    this.endReached = false;
    this.error = undefined;
    await this.loadPage();
  }

  /** Append the next page (if not yet at end). */
  async nextPage(): Promise<void> {
    if (this.loading || this.endReached) return;
    this.offset += this.pageSize;
    await this.loadPage();
  }

  private async loadPage(): Promise<void> {
    this.loading = true;
    this.emit();
    try {
      if (this.query.length > 0) {
        const hits = await this.store.searchMessages({
          text: this.query,
          ...(this.filter.mode !== undefined ? { mode: this.filter.mode } : {}),
          ...(this.filter.language !== undefined ? { language: this.filter.language } : {}),
          offset: this.offset,
          limit: this.pageSize,
        });
        this.searchHits = this.offset === 0 ? hits : [...this.searchHits, ...hits];
        this.endReached = hits.length < this.pageSize;
      } else {
        const q: SessionListQuery = {
          ...(this.filter.mode !== undefined ? { mode: this.filter.mode } : {}),
          ...(this.filter.language !== undefined ? { language: this.filter.language } : {}),
          offset: this.offset,
          limit: this.pageSize,
        };
        const rows = await this.store.listSessions(q);
        this.sessions = this.offset === 0 ? rows : [...this.sessions, ...rows];
        this.endReached = rows.length < this.pageSize;
      }
    } catch (err) {
      this.error = {
        code: this.query.length > 0 ? 'search-failed' : 'load-failed',
        message: err instanceof Error ? err.message : 'unknown',
      };
    } finally {
      this.loading = false;
      this.emit();
    }
  }

  private emit(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }
}
