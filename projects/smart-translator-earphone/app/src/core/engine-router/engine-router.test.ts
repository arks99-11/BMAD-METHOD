/**
 * Story 2.5 — Engine router tests.
 */

import { EMBEDDED_DEFAULT_POLICY, corridorKey } from './embedded-policy';
import { EngineRouter, parseRoutingPolicy } from './engine-router';
import { FakeFetcher } from '../stt/test-fakes';
import type { RoutingPolicy } from './types';

describe('Story 2.5 — embedded-policy', () => {
  test('exposes the architecture §3.4 default fallback as `fallbackCorridor`', () => {
    expect(EMBEDDED_DEFAULT_POLICY.fallbackCorridor).toEqual({
      stt: 'google',
      mt: 'google',
      tts: 'google',
    });
  });

  test('routes EN→ES through Deepgram + DeepL + Azure', () => {
    expect(EMBEDDED_DEFAULT_POLICY.corridors[corridorKey('EN', 'ES')]).toEqual({
      stt: 'deepgram',
      mt: 'deepl',
      tts: 'azure',
    });
  });

  test('routes ES→EN through Google STT + DeepL + Azure (direction-asymmetric)', () => {
    expect(EMBEDDED_DEFAULT_POLICY.corridors[corridorKey('ES', 'EN')]).toEqual({
      stt: 'google',
      mt: 'deepl',
      tts: 'azure',
    });
  });

  test('routes long-tail (VI, TH, etc.) entirely through Google', () => {
    for (const lang of ['VI', 'TH', 'ID', 'HI', 'BN', 'AR', 'TR']) {
      expect(EMBEDDED_DEFAULT_POLICY.corridors[corridorKey('EN', lang)]).toEqual({
        stt: 'google',
        mt: 'google',
        tts: 'google',
      });
      expect(EMBEDDED_DEFAULT_POLICY.corridors[corridorKey(lang, 'EN')]).toEqual({
        stt: 'google',
        mt: 'google',
        tts: 'google',
      });
    }
  });

  test('exposes an offline corridor pointed at on-device engines', () => {
    expect(EMBEDDED_DEFAULT_POLICY.offline).toEqual({
      stt: 'whisper-on-device',
      mt: 'nllb-on-device',
      tts: 'native',
    });
  });

  test('exposes a Pro context-aware corridor with GPT-4o-mini for MT', () => {
    expect(EMBEDDED_DEFAULT_POLICY.proContextAware).toEqual({
      stt: 'deepgram',
      mt: 'gpt-4o-mini',
      tts: 'elevenlabs',
    });
  });

  test('starts at version 0 (the embedded default carries no remote stamp)', () => {
    expect(EMBEDDED_DEFAULT_POLICY.version).toBe(0);
  });
});

describe('Story 2.5 — EngineRouter.decide()', () => {
  const router = new EngineRouter();

  test('matches a known corridor exactly', () => {
    const decision = router.decide({
      sourceLang: 'EN',
      targetLang: 'ES',
      online: true,
      cloudOff: false,
      tier: 'free',
    });
    expect(decision.reason).toBe('corridor');
    expect(decision.matchedCorridor).toBe('EN→ES');
    expect(decision.policy.mt).toBe('deepl');
  });

  test('falls back to `*→*` for unknown corridors', () => {
    const decision = router.decide({
      sourceLang: 'XX',
      targetLang: 'YY',
      online: true,
      cloudOff: false,
      tier: 'free',
    });
    expect(decision.reason).toBe('fallback-default');
    expect(decision.matchedCorridor).toBe('*→*');
    expect(decision.policy).toEqual({ stt: 'google', mt: 'google', tts: 'google' });
  });

  test('cloud-off wins over a matching corridor (rule 8)', () => {
    const decision = router.decide({
      sourceLang: 'EN',
      targetLang: 'ES',
      online: true,
      cloudOff: true,
      tier: 'free',
    });
    expect(decision.reason).toBe('cloud-off');
    expect(decision.matchedCorridor).toBe('offline');
    expect(decision.policy.stt).toBe('whisper-on-device');
  });

  test('offline wins when cloud-off is false but network is unavailable', () => {
    const decision = router.decide({
      sourceLang: 'EN',
      targetLang: 'ES',
      online: false,
      cloudOff: false,
      tier: 'free',
    });
    expect(decision.reason).toBe('offline');
  });

  test('Pro + contextAware routes MT to GPT-4o-mini', () => {
    const decision = router.decide({
      sourceLang: 'EN',
      targetLang: 'ES',
      online: true,
      cloudOff: false,
      tier: 'pro',
      contextAware: true,
    });
    expect(decision.reason).toBe('pro-context');
    expect(decision.policy.mt).toBe('gpt-4o-mini');
  });

  test('Pro + contextAware does NOT win over cloud-off', () => {
    const decision = router.decide({
      sourceLang: 'EN',
      targetLang: 'ES',
      online: true,
      cloudOff: true,
      tier: 'pro',
      contextAware: true,
    });
    expect(decision.reason).toBe('cloud-off');
  });

  test('Pro tier without contextAware uses the regular corridor', () => {
    const decision = router.decide({
      sourceLang: 'EN',
      targetLang: 'DE',
      online: true,
      cloudOff: false,
      tier: 'pro',
    });
    expect(decision.reason).toBe('corridor');
    expect(decision.policy.mt).toBe('deepl');
  });
});

describe('Story 2.5 — EngineRouter.refreshFromRemote()', () => {
  function policyJson(version: number, override?: Partial<RoutingPolicy>): unknown {
    return {
      version,
      corridors: {
        'EN→ES': { stt: 'deepgram', mt: 'deepl', tts: 'azure' },
      },
      fallbackCorridor: { stt: 'google', mt: 'google', tts: 'google' },
      offline: { stt: 'whisper-on-device', mt: 'nllb-on-device', tts: 'native' },
      ...(override ?? {}),
    };
  }

  test('updates the policy when a fresher version is returned', async () => {
    const fetcher = new FakeFetcher([{ body: policyJson(7) }]);
    const router = new EngineRouter();
    expect(router.getPolicy().version).toBe(0);
    const result = await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    expect(result.status).toBe('updated');
    expect(result.policy.version).toBe(7);
    expect(router.getPolicy().version).toBe(7);
  });

  test('rejects a remote payload with the same version (stale guard)', async () => {
    const fetcher = new FakeFetcher([{ body: policyJson(0) }]);
    const router = new EngineRouter();
    const result = await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    expect(result.status).toBe('unchanged');
    expect(result.error?.code).toBe('stale');
    expect(router.getPolicy().version).toBe(0);
  });

  test('preserves the active policy on a network error (architecture §3.4 fallback rule)', async () => {
    const router = new EngineRouter();
    const result = await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      fetcher: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('network');
    expect(router.getPolicy()).toBe(EMBEDDED_DEFAULT_POLICY);
  });

  test('preserves active policy on a 401 with auth error code', async () => {
    const fetcher = new FakeFetcher([{ status: 401, bodyText: 'no' }]);
    const router = new EngineRouter();
    const result = await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      authToken: 'bad',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('auth');
    expect(router.getPolicy()).toBe(EMBEDDED_DEFAULT_POLICY);
  });

  test('rejects payloads with malformed JSON (parse error)', async () => {
    const fetcher = new FakeFetcher([{ bodyText: 'not json' }]);
    const router = new EngineRouter();
    const result = await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('parse');
  });

  test('forwards the auth bearer token in the request headers', async () => {
    const fetcher = new FakeFetcher([{ body: policyJson(1) }]);
    const router = new EngineRouter();
    await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      authToken: 'secret-token',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    expect(fetcher.requests[0]?.headers['authorization']).toBe('Bearer secret-token');
  });

  test('subsequent decide() calls use the updated policy', async () => {
    const fetcher = new FakeFetcher([
      {
        body: {
          version: 1,
          corridors: { 'EN→ES': { stt: 'google', mt: 'gpt-4o-mini', tts: 'elevenlabs' } },
          fallbackCorridor: { stt: 'google', mt: 'google', tts: 'google' },
          offline: { stt: 'whisper-on-device', mt: 'nllb-on-device', tts: 'native' },
        },
      },
    ]);
    const router = new EngineRouter();
    await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      fetcher: fetcher.fetch as unknown as typeof fetch,
    });
    const decision = router.decide({
      sourceLang: 'EN',
      targetLang: 'ES',
      online: true,
      cloudOff: false,
      tier: 'free',
    });
    expect(decision.policy.mt).toBe('gpt-4o-mini');
  });

  test('allowStale lets tests force-apply a smaller version', async () => {
    const fetcher = new FakeFetcher([{ body: policyJson(0) }]);
    const router = new EngineRouter();
    const result = await router.refreshFromRemote({
      url: 'https://policy.example.com/v1',
      fetcher: fetcher.fetch as unknown as typeof fetch,
      allowStale: true,
    });
    expect(result.status).toBe('updated');
  });
});

describe('Story 2.5 — parseRoutingPolicy()', () => {
  test('rejects non-object payloads', () => {
    expect(() => parseRoutingPolicy('not-an-object')).toThrow(/JSON object/);
    expect(() => parseRoutingPolicy(null)).toThrow(/JSON object/);
  });

  test('rejects payloads without numeric version', () => {
    expect(() =>
      parseRoutingPolicy({
        corridors: {},
        fallbackCorridor: { stt: 'google', mt: 'google', tts: 'google' },
        offline: { stt: 'whisper-on-device', mt: 'nllb-on-device', tts: 'native' },
      }),
    ).toThrow(/version/);
  });

  test('rejects corridor objects missing required engine ids', () => {
    expect(() =>
      parseRoutingPolicy({
        version: 1,
        corridors: { 'EN→ES': { stt: 'deepgram' } },
        fallbackCorridor: { stt: 'google', mt: 'google', tts: 'google' },
        offline: { stt: 'whisper-on-device', mt: 'nllb-on-device', tts: 'native' },
      }),
    ).toThrow(/mt|tts/);
  });

  test('parses a valid payload with optional fallback', () => {
    const policy = parseRoutingPolicy({
      version: 5,
      corridors: {
        'EN→ES': {
          stt: 'deepgram',
          mt: 'deepl',
          tts: 'azure',
          fallback: { mt: 'google' },
        },
      },
      fallbackCorridor: { stt: 'google', mt: 'google', tts: 'google' },
      offline: { stt: 'whisper-on-device', mt: 'nllb-on-device', tts: 'native' },
      proContextAware: { stt: 'deepgram', mt: 'gpt-4o-mini', tts: 'elevenlabs' },
    });
    expect(policy.version).toBe(5);
    expect(policy.corridors['EN→ES']?.fallback?.mt).toBe('google');
    expect(policy.proContextAware?.mt).toBe('gpt-4o-mini');
  });
});
