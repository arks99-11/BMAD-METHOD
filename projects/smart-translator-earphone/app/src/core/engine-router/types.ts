/**
 * Story 2.5 — Engine router types.
 *
 * The router is the single point that decides which STT, MT, and TTS
 * engine handles a given language corridor. The policy is defined in
 * ADR-004 §Default policy and architecture §3.4; this file is the
 * TypeScript surface of that policy.
 *
 * The policy table itself is declared in `embedded-policy.ts`. The router
 * (`engine-router.ts`) consults it and exposes a `decide()` method to the
 * rest of the app.
 */

/**
 * Identifiers used by the policy table. New adapters extend these unions.
 */
export type SttEngineId = 'deepgram' | 'google' | 'whisper-on-device' | 'mock';
export type MtEngineId =
  | 'deepl'
  | 'google'
  | 'gpt-4o-mini'
  | 'nllb-on-device'
  | 'naver-papago'
  | 'mock';
export type TtsEngineId = 'elevenlabs' | 'azure' | 'google' | 'native' | 'mock';

/**
 * The three engines selected for one corridor + an optional fallback
 * (used when the primary engine returns a retry-eligible error per
 * project-context.md rule 15).
 */
export interface CorridorPolicy {
  stt: SttEngineId;
  mt: MtEngineId;
  tts: TtsEngineId;
  fallback?: {
    stt?: SttEngineId;
    mt?: MtEngineId;
    tts?: TtsEngineId;
  };
}

/**
 * The full routing policy. Keys in `corridors` use the BCP-47-flavoured
 * `${sourceLang}→${targetLang}` shape (e.g. `EN→ES`). The arrow is the
 * canonical Unicode arrow `→` (U+2192) so the same key shape is
 * unambiguous across all systems.
 *
 * `fallbackCorridor` is consulted when the requested corridor is not in
 * the table — it corresponds to the architecture-doc `*→*` row.
 *
 * `offline` is used when the user enables cloud-off mode or the device
 * has no network. It always points at on-device or no-cost engines.
 *
 * `proContextAware` (optional) is used when the Pro-tier user has the
 * "context-aware translation" mode enabled — typically routes MT to
 * GPT-4o-mini.
 */
export interface RoutingPolicy {
  corridors: Record<string, CorridorPolicy>;
  fallbackCorridor: CorridorPolicy;
  offline: CorridorPolicy;
  proContextAware?: CorridorPolicy;
  /**
   * Monotonic version stamped by the server. Local default policy starts
   * at 0; remote updates carry their own version. The router only swaps
   * the policy if the incoming version is strictly greater.
   */
  version: number;
}

/**
 * User tier as understood by the router (orthogonal to subscription
 * billing concerns).
 */
export type RouterTier = 'free' | 'pro';

/**
 * Inputs to a routing decision.
 *
 *  - `online` is the network reachability flag (set by the network
 *    monitor in `core/connectivity/`).
 *  - `cloudOff` is the user's privacy toggle ("Cloud off" mode in
 *    Settings; project-context.md rule 8: when enabled, the router MUST
 *    NOT open a WebSocket).
 *  - `contextAware` is the Pro-tier opt-in for the rolling-context MT.
 */
export interface RouteRequest {
  sourceLang: string;
  targetLang: string;
  online: boolean;
  cloudOff: boolean;
  tier: RouterTier;
  contextAware?: boolean;
}

/**
 * The router's decision for a single session start.
 *
 *  - `policy` : the chosen `CorridorPolicy`.
 *  - `reason` : the path through the decision logic that produced it.
 *               Useful for the engine-transparency UI sheet (Story 5.4)
 *               and for debug logging.
 *  - `matchedCorridor` : either the corridor key from the table, or one
 *                        of the synthetic markers `*→*`, `offline`, or
 *                        `pro-context`.
 */
export interface RouteDecision {
  policy: CorridorPolicy;
  reason: 'corridor' | 'fallback-default' | 'offline' | 'cloud-off' | 'pro-context';
  matchedCorridor: string;
}

export interface PolicyRefreshResult {
  status: 'unchanged' | 'updated' | 'failed';
  /**
   * The policy currently active *after* this refresh attempt. Always
   * defined; if the remote fetch failed, this is the previous policy.
   */
  policy: RoutingPolicy;
  /** Present if `status === 'failed'`; absent otherwise. */
  error?: { code: 'network' | 'auth' | 'parse' | 'stale' | 'unknown'; message: string };
}

export interface PolicyRefreshOptions {
  url: string;
  /**
   * Optional bearer token; the URL is expected to be a signed Cloudflare
   * Workers KV URL with a TTL, but the bearer is plumbed for symmetry
   * with other cloud calls.
   */
  authToken?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  /**
   * If true, the refresh will accept a remote policy even if its
   * `version` is less-than-or-equal-to the current. Useful only for
   * tests; production code should leave this off.
   */
  allowStale?: boolean;
}
