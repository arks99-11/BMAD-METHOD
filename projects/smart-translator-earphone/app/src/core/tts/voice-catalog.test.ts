/**
 * Story 4.4 — Voice catalog tests.
 */

import { EMBEDDED_VOICES, VoiceCatalog, type CatalogVoice } from './voice-catalog';

describe('Story 4.4 — EMBEDDED_VOICES', () => {
  test('covers every v1 launch corridor target language', () => {
    const langs = new Set(EMBEDDED_VOICES.map((v) => v.language));
    expect(langs.has('en-US')).toBe(true);
    expect(langs.has('de-DE')).toBe(true);
    expect(langs.has('es-ES')).toBe(true);
    expect(langs.has('fr-FR')).toBe(true);
    expect(langs.has('it-IT')).toBe(true);
    expect(langs.has('ja-JP')).toBe(true);
    expect(langs.has('zh-CN')).toBe(true);
    expect(langs.has('vi-VN')).toBe(true);
    expect(langs.has('ko-KR')).toBe(true);
    expect(langs.has('th-TH')).toBe(true);
    expect(langs.has('ar-SA')).toBe(true);
    expect(langs.has('hi-IN')).toBe(true);
  });

  test('every embedded voice has a stable id, providerVoiceId, tier, engine', () => {
    for (const v of EMBEDDED_VOICES) {
      expect(typeof v.id).toBe('string');
      expect(v.id.length).toBeGreaterThan(0);
      expect(typeof v.providerVoiceId).toBe('string');
      expect(['free', 'pro']).toContain(v.tier);
      expect(['azure', 'elevenlabs', 'google', 'native', 'mock']).toContain(v.engine);
    }
  });

  test('ids are unique', () => {
    const ids = new Set(EMBEDDED_VOICES.map((v) => v.id));
    expect(ids.size).toBe(EMBEDDED_VOICES.length);
  });
});

describe('Story 4.4 — VoiceCatalog', () => {
  test('seeds with EMBEDDED_VOICES by default', () => {
    const catalog = new VoiceCatalog();
    expect(catalog.size()).toBe(EMBEDDED_VOICES.length);
  });

  test('byLanguage returns matches sorted by quality and tier', () => {
    const catalog = new VoiceCatalog();
    const en = catalog.byLanguage('en-US');
    expect(en.length).toBe(3);
    expect(en[0]?.quality).toBe('premium');
  });

  test('byLanguage is case-insensitive', () => {
    const catalog = new VoiceCatalog();
    expect(catalog.byLanguage('EN-US').length).toBe(3);
    expect(catalog.byLanguage('en-us').length).toBe(3);
  });

  test('pickDefault free returns a free voice for free users', () => {
    const catalog = new VoiceCatalog();
    const def = catalog.pickDefault('en-US', 'free');
    expect(def?.tier).toBe('free');
  });

  test('pickDefault pro can return a pro voice', () => {
    const catalog = new VoiceCatalog();
    const def = catalog.pickDefault('en-US', 'pro');
    expect(def?.tier).toBe('pro');
  });

  test('pickDefault returns undefined for unknown language', () => {
    const catalog = new VoiceCatalog();
    expect(catalog.pickDefault('xx-XX')).toBeUndefined();
  });

  test('pickDefault free falls back to pro voice if no free voice exists', () => {
    const catalog = new VoiceCatalog([]);
    const proVoice: CatalogVoice = {
      id: 'pro-only',
      name: 'pro',
      language: 'xx-XX',
      engine: 'elevenlabs',
      providerVoiceId: 'p',
      tier: 'pro',
    };
    catalog.upsert(proVoice);
    expect(catalog.pickDefault('xx-XX', 'free')).toEqual(proVoice);
  });

  test('upsert adds a new voice and replaces an existing one', () => {
    const catalog = new VoiceCatalog([]);
    catalog.upsert({
      id: 'a',
      name: 'A',
      language: 'en-US',
      engine: 'native',
      providerVoiceId: 'p1',
      tier: 'free',
    });
    expect(catalog.get('a')?.providerVoiceId).toBe('p1');
    catalog.upsert({
      id: 'a',
      name: 'A',
      language: 'en-US',
      engine: 'native',
      providerVoiceId: 'p2',
      tier: 'free',
    });
    expect(catalog.get('a')?.providerVoiceId).toBe('p2');
    expect(catalog.size()).toBe(1);
  });

  test('remove drops a voice', () => {
    const catalog = new VoiceCatalog([]);
    catalog.upsert({
      id: 'a',
      name: 'A',
      language: 'en-US',
      engine: 'native',
      providerVoiceId: 'p',
      tier: 'free',
    });
    catalog.remove('a');
    expect(catalog.get('a')).toBeUndefined();
  });

  test('list returns all voices', () => {
    const catalog = new VoiceCatalog();
    expect(catalog.list().length).toBe(EMBEDDED_VOICES.length);
  });
});
