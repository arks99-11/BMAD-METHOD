/**
 * Public surface of the core/engine-router module (Story 2.5).
 */

export type {
  CorridorPolicy,
  MtEngineId,
  PolicyRefreshOptions,
  PolicyRefreshResult,
  RouteDecision,
  RouteRequest,
  RouterTier,
  RoutingPolicy,
  SttEngineId,
  TtsEngineId,
} from './types';

export { EMBEDDED_DEFAULT_POLICY, corridorKey } from './embedded-policy';
export { EngineRouter, parseRoutingPolicy } from './engine-router';
