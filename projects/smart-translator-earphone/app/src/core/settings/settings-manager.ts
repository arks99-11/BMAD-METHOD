/**
 * Story 7.3 — Settings manager.
 *
 * Reads / writes the typed `AppSettings` tree against any `LocalStore`
 * implementation. The UI subscribes via `on(listener)`; mutations
 * persist immediately to the store and broadcast the new tree.
 */

import type { LocalStore } from '../store/store-types';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  type AccountSettings,
  type AppSettings,
  type AudioSettings,
  type LanguagesSettings,
  type PrivacySettings,
  type VoicePreferences,
} from './settings-schema';

export type SettingsListener = (settings: AppSettings) => void;

export class SettingsManager {
  private readonly store: LocalStore;
  private current: AppSettings = cloneDefaults();
  private readonly listeners = new Set<SettingsListener>();
  private loaded = false;

  constructor(store: LocalStore) {
    this.store = store;
  }

  on(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Hydrate from the store. Falls back to defaults on missing keys. */
  async load(): Promise<AppSettings> {
    const next = cloneDefaults();
    next.languages = await this.read('languages', next.languages);
    next.voice = await this.read('voice', next.voice);
    next.privacy = await this.read('privacy', next.privacy);
    next.audio = await this.read('audio', next.audio);
    next.account = await this.read('account', next.account);
    this.current = next;
    this.loaded = true;
    this.emit();
    return this.current;
  }

  get(): AppSettings {
    return cloneTree(this.current);
  }

  async setLanguages(patch: Partial<LanguagesSettings>): Promise<void> {
    this.current = { ...this.current, languages: { ...this.current.languages, ...patch } };
    await this.write('languages', this.current.languages);
  }

  async setVoice(patch: Partial<VoicePreferences>): Promise<void> {
    this.current = { ...this.current, voice: { ...this.current.voice, ...patch } };
    await this.write('voice', this.current.voice);
  }

  async setPrivacy(patch: Partial<PrivacySettings>): Promise<void> {
    this.current = { ...this.current, privacy: { ...this.current.privacy, ...patch } };
    await this.write('privacy', this.current.privacy);
  }

  async setAudio(patch: Partial<AudioSettings>): Promise<void> {
    this.current = { ...this.current, audio: { ...this.current.audio, ...patch } };
    await this.write('audio', this.current.audio);
  }

  async setAccount(patch: Partial<AccountSettings>): Promise<void> {
    this.current = { ...this.current, account: { ...this.current.account, ...patch } };
    await this.write('account', this.current.account);
  }

  /** Reset to defaults; persists immediately. */
  async resetAll(): Promise<void> {
    this.current = cloneDefaults();
    await this.write('languages', this.current.languages);
    await this.write('voice', this.current.voice);
    await this.write('privacy', this.current.privacy);
    await this.write('audio', this.current.audio);
    await this.write('account', this.current.account);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  private async read<K extends keyof AppSettings>(
    section: K,
    fallback: AppSettings[K],
  ): Promise<AppSettings[K]> {
    const raw = await this.store.getSetting(SETTINGS_KEYS[section]);
    if (raw === undefined) return fallback;
    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings[K]>;
      return { ...fallback, ...parsed };
    } catch {
      return fallback;
    }
  }

  private async write<K extends keyof AppSettings>(
    section: K,
    value: AppSettings[K],
  ): Promise<void> {
    await this.store.setSetting(SETTINGS_KEYS[section], JSON.stringify(value));
    this.emit();
  }

  private emit(): void {
    const snap = cloneTree(this.current);
    for (const l of this.listeners) l(snap);
  }
}

function cloneDefaults(): AppSettings {
  return cloneTree(DEFAULT_SETTINGS);
}

function cloneTree(s: AppSettings): AppSettings {
  return {
    languages: { ...s.languages },
    voice: { ...s.voice },
    privacy: { ...s.privacy },
    audio: { ...s.audio },
    account: { ...s.account },
  };
}
