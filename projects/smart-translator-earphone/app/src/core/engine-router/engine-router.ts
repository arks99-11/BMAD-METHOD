/**
 * Story 2.5 — Engine Router.
 *
 * The router holds the active `RoutingPolicy` (initially the embedded
 * default) and exposes:
 *
 *   - `decide(req)`  : synchronous routing decision per session start.
 *   - `refreshFromRemote(opts)` : attempts to fetch a fresher policy
 *     from the remote-config endpoint. Falls back to the current policy
 *     (which may be the embedded default) on any error. Verifies that
 *     the incoming policy has a strictly greater `version` (project-
 *     context.md rule "monotonic policy versions") before applying.
 *
 * The router is **decision-only** — it does not instantiate adapters.
 * The caller looks the resolved engine ids up in registries it owns.
 * This keeps the router pure and trivially testable.
 *
 * `cloud-off` and `offline` paths are checked first so they win over a
 * matching corridor entry. This satisfies project-context.md rule 8
 * ("`cloud_off === true` is a hard gate; engine router must never open a
 * WebSocket") and architecture §3.4 ("If `cloud_off === true` or no
 * network, the router returns the on-device pipeline regardless of
 * policy").
 */

import { EMBEDDED_DEFAULT_POLICY, corridorKey } from './embedded-policy';
import type {
  PolicyRefreshOptions,
  PolicyRefreshResult,
  RouteDecision,
  RouteRequest,
  RoutingPolicy,
} from './types';

export class EngineRouter {
  private policy: RoutingPolicy;

  constructor(initial: RoutingPolicy = EMBEDDED_DEFAULT_POLICY) {
    this.policy = initial;
  }

  /**
   * The active policy. Read-only from outside; tests can use it to
   * assert that `refreshFromRemote` swapped the policy.
   */
  getPolicy(): RoutingPolicy {
    return this.policy;
  }

  decide(req: RouteRequest): RouteDecision {
    // Privacy / connectivity hard gates first. cloud-off wins over
    // online so the user can simulate offline routing without dropping
    // the network.
    if (req.cloudOff) {
      return {
        policy: this.policy.offline,
        reason: 'cloud-off',
        matchedCorridor: 'offline',
      };
    }
    if (!req.online) {
      return {
        policy: this.policy.offline,
        reason: 'offline',
        matchedCorridor: 'offline',
      };
    }
    if (
      req.tier === 'pro' &&
      req.contextAware === true &&
      this.policy.proContextAware !== undefined
    ) {
      return {
        policy: this.policy.proContextAware,
        reason: 'pro-context',
        matchedCorridor: 'pro-context',
      };
    }
    const key = corridorKey(req.sourceLang, req.targetLang);
    const direct = this.policy.corridors[key];
    if (direct !== undefined) {
      return {
        policy: direct,
        reason: 'corridor',
        matchedCorridor: key,
      };
    }
    return {
      policy: this.policy.fallbackCorridor,
      reason: 'fallback-default',
      matchedCorridor: '*→*',
    };
  }

  /**
   * Try to fetch a fresher policy from the remote-config endpoint.
   *
   * On any failure (network, auth, parse, stale), the current policy is
   * preserved and the result reflects the failure. Callers should
   * surface a non-blocking warning at most — the embedded default is
   * always a working fallback.
   */
  async refreshFromRemote(opts: PolicyRefreshOptions): Promise<PolicyRefreshResult> {
    const fetcher = resolveFetcher(opts);
    let res: { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
    try {
      const init: RequestInit = {
        method: 'GET',
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        ...(opts.authToken !== undefined
          ? { headers: { authorization: `Bearer ${opts.authToken}` } }
          : {}),
      };
      res = (await fetcher(opts.url, init)) as typeof res;
    } catch (err) {
      return {
        status: 'failed',
        policy: this.policy,
        error: { code: 'network', message: errorMessage(err) },
      };
    }
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? 'auth' : 'unknown';
      return {
        status: 'failed',
        policy: this.policy,
        error: { code, message: `Remote policy fetch failed: HTTP ${res.status}` },
      };
    }
    let parsed: RoutingPolicy;
    try {
      const raw = (await res.json()) as unknown;
      parsed = parseRoutingPolicy(raw);
    } catch (err) {
      return {
        status: 'failed',
        policy: this.policy,
        error: { code: 'parse', message: errorMessage(err) },
      };
    }
    const allowStale = opts.allowStale === true;
    if (!allowStale && parsed.version <= this.policy.version) {
      return {
        status: 'unchanged',
        policy: this.policy,
        error: {
          code: 'stale',
          message: `Remote policy version ${parsed.version} is not greater than active ${this.policy.version}.`,
        },
      };
    }
    this.policy = parsed;
    return { status: 'updated', policy: this.policy };
  }
}

function resolveFetcher(opts: PolicyRefreshOptions): typeof fetch {
  if (opts.fetcher !== undefined) return opts.fetcher;
  if (typeof fetch === 'undefined') {
    throw new Error(
      'EngineRouter.refreshFromRemote: no global fetch available. Pass `fetcher` in non-browser/non-RN environments.',
    );
  }
  return fetch;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Parse and validate a remote payload as a `RoutingPolicy`. Rejects
 * payloads that are missing required structure rather than silently
 * accepting partial data.
 */
export function parseRoutingPolicy(raw: unknown): RoutingPolicy {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Routing policy must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj['version'] !== 'number') {
    throw new Error('Routing policy missing numeric `version`.');
  }
  if (typeof obj['corridors'] !== 'object' || obj['corridors'] === null) {
    throw new Error('Routing policy missing `corridors` object.');
  }
  const corridorsRaw = obj['corridors'] as Record<string, unknown>;
  const corridors: RoutingPolicy['corridors'] = {};
  for (const [k, v] of Object.entries(corridorsRaw)) {
    corridors[k] = parseCorridorPolicy(v, `corridors[${k}]`);
  }
  const fallback = parseCorridorPolicy(obj['fallbackCorridor'], 'fallbackCorridor');
  const offline = parseCorridorPolicy(obj['offline'], 'offline');
  const out: RoutingPolicy = {
    version: obj['version'],
    corridors,
    fallbackCorridor: fallback,
    offline,
  };
  if (obj['proContextAware'] !== undefined) {
    out.proContextAware = parseCorridorPolicy(obj['proContextAware'], 'proContextAware');
  }
  return out;
}

function parseCorridorPolicy(raw: unknown, path: string): import('./types').CorridorPolicy {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path}: must be a JSON object.`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o['stt'] !== 'string') throw new Error(`${path}.stt must be a string`);
  if (typeof o['mt'] !== 'string') throw new Error(`${path}.mt must be a string`);
  if (typeof o['tts'] !== 'string') throw new Error(`${path}.tts must be a string`);
  const policy: import('./types').CorridorPolicy = {
    stt: o['stt'] as import('./types').SttEngineId,
    mt: o['mt'] as import('./types').MtEngineId,
    tts: o['tts'] as import('./types').TtsEngineId,
  };
  if (o['fallback'] !== undefined) {
    if (typeof o['fallback'] !== 'object' || o['fallback'] === null) {
      throw new Error(`${path}.fallback must be a JSON object.`);
    }
    const fb = o['fallback'] as Record<string, unknown>;
    const fallback: NonNullable<import('./types').CorridorPolicy['fallback']> = {};
    if (fb['stt'] !== undefined) fallback.stt = fb['stt'] as import('./types').SttEngineId;
    if (fb['mt'] !== undefined) fallback.mt = fb['mt'] as import('./types').MtEngineId;
    if (fb['tts'] !== undefined) fallback.tts = fb['tts'] as import('./types').TtsEngineId;
    policy.fallback = fallback;
  }
  return policy;
}
