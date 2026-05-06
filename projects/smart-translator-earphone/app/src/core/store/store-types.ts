/**
 * Story 7.1 — Local store schema and contracts.
 *
 * The local store persists session metadata, per-turn transcript
 * messages, downloaded language packs, and the settings tree (Story
 * 7.3). The production implementation backs onto SQLite + FTS5 inside
 * the React Native shell; this file defines the JS-side contract so
 * the rest of the app and the in-memory test store both target the
 * same surface.
 *
 * Schema (architecture §3.7):
 *
 *   sessions         (id, mode, sourceLang, targetLang, startedAt,
 *                     endedAt?, voiceId?, deviceId?, isShared?)
 *   messages         (id, sessionId, side, lang, text, isFinal,
 *                     turnId, ts, engine?)
 *   messages_fts     (FTS5 over messages.text)
 *   language_packs   (id, lang, sttEngine?, mtEngine?, version,
 *                     sizeBytes, downloadedAt)
 *   settings         (key, value)
 *
 * The store API does not expose raw SQL; callers operate on typed
 * records. Migrations are versioned and applied transactionally
 * during `init()`.
 */

import type { LangCode } from '../audio/audio-session-types';

/** Mode of a recorded session. */
export type SessionMode = 'conversation' | 'lecture';

/** Side of a transcript message. */
export type TranscriptSide = 'source' | 'target';

export interface SessionRecord {
  id: string;
  mode: SessionMode;
  sourceLang: LangCode;
  targetLang: LangCode;
  startedAt: number;
  endedAt?: number;
  voiceId?: string;
  /** Number of completed turns in this session. */
  turnCount: number;
  /** Optional title (user can rename). */
  title?: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  turnId: string;
  side: TranscriptSide;
  lang: LangCode;
  text: string;
  isFinal: boolean;
  ts: number;
  /** Engine that produced this side, if known. */
  engine?: string;
}

export interface LanguagePackRecord {
  id: string;
  lang: LangCode;
  /** Optional STT engine label (e.g. 'whisper-tiny'). */
  sttEngine?: string;
  /** Optional MT engine label (e.g. 'nllb-distilled-600m'). */
  mtEngine?: string;
  version: string;
  sizeBytes: number;
  downloadedAt: number;
}

export interface SessionListQuery {
  /** Optional mode filter. */
  mode?: SessionMode;
  /** Optional language filter (matches either side). */
  language?: LangCode;
  /** Pagination — start row (defaults 0). */
  offset?: number;
  /** Pagination — page size (defaults 50). */
  limit?: number;
}

export interface MessageSearchHit {
  message: MessageRecord;
  /** Matched session for grouping in the UI. */
  session: SessionRecord;
  /** Optional rank score from FTS5; higher is better. */
  rank?: number;
  /** Optional snippet with `<mark>` around hits. */
  snippet?: string;
}

export interface MessageSearchQuery {
  /** Free-text query. */
  text: string;
  /** Optional mode filter. */
  mode?: SessionMode;
  /** Optional language filter. */
  language?: LangCode;
  /** Pagination. */
  offset?: number;
  limit?: number;
}

export interface SettingsRecord {
  key: string;
  value: string;
}

/**
 * The full local-store contract. SQLite-backed implementations live
 * in the RN shell; the in-memory implementation in this PR is for
 * unit tests.
 */
export interface LocalStore {
  /** Apply migrations and ensure the store is ready to use. */
  init(): Promise<void>;

  // --- Sessions ---
  insertSession(session: SessionRecord): Promise<void>;
  updateSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | undefined>;
  listSessions(q?: SessionListQuery): Promise<SessionRecord[]>;
  deleteSession(id: string): Promise<void>;

  // --- Messages ---
  insertMessage(message: MessageRecord): Promise<void>;
  updateMessage(message: MessageRecord): Promise<void>;
  listMessages(sessionId: string): Promise<MessageRecord[]>;
  searchMessages(q: MessageSearchQuery): Promise<MessageSearchHit[]>;

  // --- Language packs ---
  upsertLanguagePack(pack: LanguagePackRecord): Promise<void>;
  listLanguagePacks(): Promise<LanguagePackRecord[]>;
  removeLanguagePack(id: string): Promise<void>;

  // --- Settings ---
  setSetting(key: string, value: string): Promise<void>;
  getSetting(key: string): Promise<string | undefined>;
  listSettings(): Promise<SettingsRecord[]>;
}
