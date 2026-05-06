/**
 * Story 7.3 — SettingsManager tests.
 */

import { InMemoryStore } from '../store/in-memory-store';
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from './settings-schema';
import { SettingsManager } from './settings-manager';

async function build(): Promise<{ store: InMemoryStore; mgr: SettingsManager }> {
  const store = new InMemoryStore();
  await store.init();
  const mgr = new SettingsManager(store);
  return { store, mgr };
}

describe('SettingsManager', () => {
  it('returns defaults before load()', async () => {
    const { mgr } = await build();
    expect(mgr.get()).toEqual(DEFAULT_SETTINGS);
    expect(mgr.isLoaded()).toBe(false);
  });

  it('load() populates from defaults when store is empty', async () => {
    const { mgr } = await build();
    const loaded = await mgr.load();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(mgr.isLoaded()).toBe(true);
  });

  it('persists section patches through the store', async () => {
    const { store, mgr } = await build();
    await mgr.load();
    await mgr.setLanguages({ defaultSourceLang: 'DE' });
    const raw = await store.getSetting(SETTINGS_KEYS.languages);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!).defaultSourceLang).toBe('DE');
    expect(mgr.get().languages.defaultSourceLang).toBe('DE');
    expect(mgr.get().languages.defaultTargetLang).toBe('ES');
  });

  it('emits the new settings tree to listeners', async () => {
    const { mgr } = await build();
    await mgr.load();
    const captured: string[] = [];
    mgr.on((s) => captured.push(s.account.tier));
    await mgr.setAccount({ tier: 'pro' });
    expect(captured.at(-1)).toBe('pro');
  });

  it('supports setVoice / setPrivacy / setAudio / setAccount', async () => {
    const { mgr } = await build();
    await mgr.load();
    await mgr.setVoice({ rate: 1.25 });
    await mgr.setPrivacy({ cloudOff: true });
    await mgr.setAudio({ outputRoute: 'speaker' });
    await mgr.setAccount({ tier: 'pro', contextAware: true });
    const s = mgr.get();
    expect(s.voice.rate).toBe(1.25);
    expect(s.privacy.cloudOff).toBe(true);
    expect(s.audio.outputRoute).toBe('speaker');
    expect(s.account.tier).toBe('pro');
    expect(s.account.contextAware).toBe(true);
  });

  it('load() falls back to defaults when stored value is invalid JSON', async () => {
    const { store, mgr } = await build();
    await store.setSetting(SETTINGS_KEYS.voice, 'not-json{');
    const loaded = await mgr.load();
    expect(loaded.voice).toEqual(DEFAULT_SETTINGS.voice);
  });

  it('hydrates partially-stored sections by merging with defaults', async () => {
    const { store, mgr } = await build();
    // Only the rate is stored; other fields should fill in from defaults.
    await store.setSetting(SETTINGS_KEYS.voice, JSON.stringify({ rate: 0.8 }));
    await mgr.load();
    expect(mgr.get().voice.rate).toBe(0.8);
    expect(mgr.get().voice.voiceId).toBe(DEFAULT_SETTINGS.voice.voiceId);
  });

  it('resetAll restores defaults and persists them', async () => {
    const { store, mgr } = await build();
    await mgr.load();
    await mgr.setAccount({ tier: 'pro' });
    expect(mgr.get().account.tier).toBe('pro');
    await mgr.resetAll();
    expect(mgr.get().account.tier).toBe('free');
    const raw = await store.getSetting(SETTINGS_KEYS.account);
    expect(JSON.parse(raw!).tier).toBe('free');
  });

  it('on() returns an unsubscribe function', async () => {
    const { mgr } = await build();
    await mgr.load();
    let count = 0;
    const off = mgr.on(() => {
      count += 1;
    });
    await mgr.setAudio({ noiseReduction: false });
    off();
    await mgr.setAudio({ noiseReduction: true });
    expect(count).toBe(1);
  });
});
