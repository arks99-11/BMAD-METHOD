/**
 * Story 4.4 — Voice catalog.
 *
 * Maps the user's voice selection (a stable id displayed in the UI)
 * onto the provider-specific voice id required by the adapter. The
 * catalog also exposes display metadata (name, language, gender,
 * sample url) for the picker UI.
 *
 * The catalog has two sources:
 *
 *  1. **Embedded defaults** — pre-seeded list of high-quality voices
 *     for the v1 launch corridors. Hard-coded so the app works on
 *     first launch with no network.
 *
 *  2. **Runtime additions** — the native bridge (Story 4.3a)
 *     contributes its installed voices on session start; remote
 *     config (Story 7.7) can add cloud voices unlocked for the user's
 *     subscription tier.
 *
 * Voice ids are stable strings the catalog owns. The mapping
 * `voiceId → (engine, providerVoiceId)` is internal; callers ask for
 * a voice by user-facing id and get back the resolved provider hint.
 */

import type { TtsEngine } from './tts-types';

export interface CatalogVoice {
  /** Stable id surfaced to the UI and persisted in user settings. */
  id: string;
  /** Display name, localised by the UI. */
  name: string;
  /** BCP-47 language code. */
  language: string;
  engine: TtsEngine;
  /** Provider-specific voice id (ElevenLabs voice id, Azure neural name, …). */
  providerVoiceId: string;
  gender?: 'male' | 'female' | 'unspecified';
  /** Tier required: 'free' for everyone, 'pro' for paid subscribers. */
  tier: 'free' | 'pro';
  /** Optional URL to a sample audio clip for the picker preview. */
  sampleUrl?: string;
  /** Quality hint surfaced in the picker. */
  quality?: 'standard' | 'premium';
}

export class VoiceCatalog {
  private readonly voices = new Map<string, CatalogVoice>();

  constructor(seed: readonly CatalogVoice[] = EMBEDDED_VOICES) {
    for (const v of seed) {
      this.voices.set(v.id, v);
    }
  }

  /** Add or replace a voice. Used by the runtime native bridge sync. */
  upsert(voice: CatalogVoice): void {
    this.voices.set(voice.id, voice);
  }

  /** Remove a voice; no-op if it isn't registered. */
  remove(id: string): void {
    this.voices.delete(id);
  }

  /** Get a voice by stable id. */
  get(id: string): CatalogVoice | undefined {
    return this.voices.get(id);
  }

  /** All voices for a given language. */
  byLanguage(language: string): CatalogVoice[] {
    const lower = language.toLowerCase();
    const out: CatalogVoice[] = [];
    for (const v of this.voices.values()) {
      if (v.language.toLowerCase() === lower) {
        out.push(v);
      }
    }
    out.sort((a, b) => sortRank(a) - sortRank(b));
    return out;
  }

  /**
   * Pick a default voice for `language` honouring the user's tier.
   * Returns the first 'free' voice for the language; falls back to a
   * 'pro' voice only if no free voice exists for the language.
   */
  pickDefault(language: string, tier: 'free' | 'pro' = 'free'): CatalogVoice | undefined {
    const candidates = this.byLanguage(language);
    if (candidates.length === 0) return undefined;
    if (tier === 'pro') return candidates[0];
    const free = candidates.find((v) => v.tier === 'free');
    return free ?? candidates[0];
  }

  /** All voices in the catalog. Useful for tests / debugging. */
  list(): CatalogVoice[] {
    return [...this.voices.values()];
  }

  /** Number of voices registered. */
  size(): number {
    return this.voices.size;
  }
}

function sortRank(v: CatalogVoice): number {
  // Premium ahead of standard; pro ahead of free (so pro users see
  // their unlocked voices first).
  let r = 0;
  if (v.quality === 'premium') r -= 10;
  if (v.tier === 'pro') r -= 1;
  return r;
}

/**
 * v1 launch voice list. Pre-seeded for the corridors in ADR-004
 * §Default policy. The UI Picker (Story 4.4 UI in Epic 6) consumes
 * `byLanguage(target)` to render the choices.
 */
export const EMBEDDED_VOICES: readonly CatalogVoice[] = Object.freeze([
  // English (en-US)
  {
    id: 'azure-en-us-jenny',
    name: 'Jenny',
    language: 'en-US',
    engine: 'azure',
    providerVoiceId: 'en-US-JennyNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  {
    id: 'azure-en-us-guy',
    name: 'Guy',
    language: 'en-US',
    engine: 'azure',
    providerVoiceId: 'en-US-GuyNeural',
    gender: 'male',
    tier: 'free',
    quality: 'standard',
  },
  {
    id: 'eleven-en-rachel',
    name: 'Rachel (premium)',
    language: 'en-US',
    engine: 'elevenlabs',
    providerVoiceId: '21m00Tcm4TlvDq8ikWAM',
    gender: 'female',
    tier: 'pro',
    quality: 'premium',
  },
  // German
  {
    id: 'azure-de-de-katja',
    name: 'Katja',
    language: 'de-DE',
    engine: 'azure',
    providerVoiceId: 'de-DE-KatjaNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Spanish
  {
    id: 'azure-es-es-elvira',
    name: 'Elvira',
    language: 'es-ES',
    engine: 'azure',
    providerVoiceId: 'es-ES-ElviraNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // French
  {
    id: 'azure-fr-fr-denise',
    name: 'Denise',
    language: 'fr-FR',
    engine: 'azure',
    providerVoiceId: 'fr-FR-DeniseNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Italian
  {
    id: 'azure-it-it-elsa',
    name: 'Elsa',
    language: 'it-IT',
    engine: 'azure',
    providerVoiceId: 'it-IT-ElsaNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Japanese
  {
    id: 'azure-ja-jp-nanami',
    name: 'Nanami',
    language: 'ja-JP',
    engine: 'azure',
    providerVoiceId: 'ja-JP-NanamiNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Chinese (Simplified)
  {
    id: 'azure-zh-cn-xiaoxiao',
    name: 'Xiaoxiao',
    language: 'zh-CN',
    engine: 'azure',
    providerVoiceId: 'zh-CN-XiaoxiaoNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Vietnamese
  {
    id: 'azure-vi-vn-hoaimy',
    name: 'HoaiMy',
    language: 'vi-VN',
    engine: 'azure',
    providerVoiceId: 'vi-VN-HoaiMyNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Korean
  {
    id: 'azure-ko-kr-sunhi',
    name: 'SunHi',
    language: 'ko-KR',
    engine: 'azure',
    providerVoiceId: 'ko-KR-SunHiNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Thai
  {
    id: 'azure-th-th-premwadee',
    name: 'Premwadee',
    language: 'th-TH',
    engine: 'azure',
    providerVoiceId: 'th-TH-PremwadeeNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Arabic
  {
    id: 'azure-ar-sa-zariyah',
    name: 'Zariyah',
    language: 'ar-SA',
    engine: 'azure',
    providerVoiceId: 'ar-SA-ZariyahNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
  // Hindi
  {
    id: 'azure-hi-in-swara',
    name: 'Swara',
    language: 'hi-IN',
    engine: 'azure',
    providerVoiceId: 'hi-IN-SwaraNeural',
    gender: 'female',
    tier: 'free',
    quality: 'standard',
  },
]);
