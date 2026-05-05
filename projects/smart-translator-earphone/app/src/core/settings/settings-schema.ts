/**
 * Story 7.3 — Typed settings tree.
 *
 * The settings UI (UX §3.7) is organised into sections (Languages,
 * Voice, Privacy, Audio, Account). Each section maps to a typed slice
 * of this schema. Persistence flows through `LocalStore.setSetting`
 * with stringified JSON values keyed by `Settings*` enum members.
 *
 * Defaults match the architecture's "free tier, online" baseline. The
 * UI is responsible for rejecting changes the user can't make (e.g.
 * pro-only voice families when on free tier).
 */

import type { LangCode } from '../audio/audio-session-types';

export interface LanguagesSettings {
  /** Default source language. */
  defaultSourceLang: LangCode;
  /** Default target language. */
  defaultTargetLang: LangCode;
  /** Enable on-launch language detection (Story 2.4). */
  autoLanguageDetect: boolean;
}

export interface VoiceSettings {
  /** Selected voice id (resolves via VoiceCatalog). */
  voiceId: string;
  /** Speech rate multiplier; 1.0 = vendor default. */
  rate: number;
  /** Speech pitch multiplier; 1.0 = vendor default. */
  pitch: number;
}

export interface PrivacySettings {
  /**
   * Hard cloud gate (project-context.md rule 8). When true, the
   * engine router never opens a WS or hits a cloud API.
   */
  cloudOff: boolean;
  /** Persist transcripts to local SQLite store. */
  saveHistory: boolean;
  /** Send anonymised telemetry events (Story 10.1). */
  telemetryOptIn: boolean;
}

export interface AudioSettings {
  /** Enable noise reduction (Story 1.4). */
  noiseReduction: boolean;
  /** Output route preference. */
  outputRoute: 'earphone' | 'speaker' | 'both';
}

export interface AccountSettings {
  /** Tier; 'free' until the user signs in and verifies a subscription. */
  tier: 'free' | 'pro';
  /**
   * Enable rolling-context translation (Story 3.3). Pro-tier opt-in.
   */
  contextAware: boolean;
  /** Optional user-id from the auth provider. */
  userId?: string;
  /** Optional display name. */
  displayName?: string;
}

export interface AppSettings {
  languages: LanguagesSettings;
  voice: VoiceSettings;
  privacy: PrivacySettings;
  audio: AudioSettings;
  account: AccountSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  languages: {
    defaultSourceLang: 'EN',
    defaultTargetLang: 'ES',
    autoLanguageDetect: true,
  },
  voice: {
    voiceId: 'azure-en-us-jenny',
    rate: 1.0,
    pitch: 1.0,
  },
  privacy: {
    cloudOff: false,
    saveHistory: true,
    telemetryOptIn: false,
  },
  audio: {
    noiseReduction: true,
    outputRoute: 'earphone',
  },
  account: {
    tier: 'free',
    contextAware: false,
  },
};

/**
 * Stable storage keys. Values are JSON-stringified `AppSettings`
 * sections so the per-section payload can grow without touching the
 * other sections' rows.
 */
export const SETTINGS_KEYS = Object.freeze({
  languages: 'app.languages',
  voice: 'app.voice',
  privacy: 'app.privacy',
  audio: 'app.audio',
  account: 'app.account',
} as const);
