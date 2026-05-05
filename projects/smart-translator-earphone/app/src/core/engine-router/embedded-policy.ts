/**
 * Story 2.5 — Embedded fallback policy.
 *
 * This is the canonical default routing policy that ships in the binary.
 * It is the source of truth used:
 *   1. At app launch, before the remote-config fetch completes.
 *   2. As the fallback if the remote fetch fails or returns an older
 *      `version`.
 *   3. As the offline policy when the user has cloud-off enabled.
 *
 * The corridors below are derived directly from ADR-004 §Default policy
 * and architecture.md §3.4. Any change here is a content change to the
 * v1 launch policy and should reference the corresponding ADR amendment.
 *
 * Naver Papago is in ADR-004 for the `EN ↔ KO` corridor but is **not**
 * in the v1 adapter set; the embedded policy routes KO to Google for v1
 * with a remote-config refresh able to switch corridors to Naver Papago
 * once the adapter ships.
 */

import type { CorridorPolicy, RoutingPolicy } from './types';

/**
 * Languages where DeepL is the MT primary per ADR-004. Source ↔ target
 * pairing is written explicitly so we cover both directions.
 */
const DEEPL_PRIMARY_LANGS = [
  'DE',
  'FR',
  'ES',
  'IT',
  'NL',
  'PL',
  'PT',
  'RU',
  'JA',
  'ZH',
] as const;

/**
 * Languages where Google is MT primary per ADR-004 (the FR-4 long-tail).
 */
const GOOGLE_PRIMARY_LANGS = ['VI', 'TH', 'ID', 'HI', 'BN', 'AR', 'TR'] as const;

/**
 * Languages routed through Google in v1 because their dedicated vendor
 * (Naver Papago) is not yet in the adapter set. ADR-004 lists KO under
 * Naver Papago; remote-config can flip this corridor once 2026-Q3 lands
 * the Papago adapter.
 */
const KO_DEFERRED_LANGS = ['KO'] as const;

const DEEPL_AZURE: CorridorPolicy = { stt: 'deepgram', mt: 'deepl', tts: 'azure' };
const GOOGLE_GOOGLE_AZURE: CorridorPolicy = { stt: 'google', mt: 'deepl', tts: 'azure' };
const GOOGLE_FULL: CorridorPolicy = { stt: 'google', mt: 'google', tts: 'google' };

function buildCorridors(): Record<string, CorridorPolicy> {
  const out: Record<string, CorridorPolicy> = {};

  // DeepL primary corridors. Direction-asymmetric STT: `EN→XX` uses
  // Deepgram (best EN STT); `XX→EN` uses Google (best long-tail STT).
  for (const lang of DEEPL_PRIMARY_LANGS) {
    out[`EN→${lang}`] = DEEPL_AZURE;
    out[`${lang}→EN`] = GOOGLE_GOOGLE_AZURE;
  }
  for (const lang of GOOGLE_PRIMARY_LANGS) {
    out[`EN→${lang}`] = GOOGLE_FULL;
    out[`${lang}→EN`] = GOOGLE_FULL;
  }
  for (const lang of KO_DEFERRED_LANGS) {
    out[`EN→${lang}`] = GOOGLE_FULL;
    out[`${lang}→EN`] = GOOGLE_FULL;
  }
  return out;
}

export const EMBEDDED_DEFAULT_POLICY: RoutingPolicy = {
  version: 0,
  corridors: buildCorridors(),
  fallbackCorridor: GOOGLE_FULL, // architecture §3.4 `*→*`
  offline: {
    stt: 'whisper-on-device',
    mt: 'nllb-on-device',
    tts: 'native',
  },
  proContextAware: {
    stt: 'deepgram',
    mt: 'gpt-4o-mini',
    tts: 'elevenlabs',
  },
};

/**
 * Convenience: the canonical corridor key shape used by the policy.
 *
 * Note the use of `→` (U+2192). The ASCII arrow `->` is intentionally
 * NOT supported to avoid silently mis-keying lookups.
 */
export function corridorKey(source: string, target: string): string {
  return `${source}→${target}`;
}
