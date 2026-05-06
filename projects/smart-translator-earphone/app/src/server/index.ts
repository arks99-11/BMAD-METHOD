/**
 * Public surface of the server plane (Epic 11).
 *
 * The actual Cloudflare Workers entry point + Wrangler config land
 * during deployment; this module ships the pure-TS pieces (relay
 * protocol, KV-backed session store, telemetry-ingest validator)
 * and minimal type shims so they compile in this repo without an
 * @cloudflare/workers-types dependency.
 */

export type {
  KVNamespace,
  DurableObjectState,
  DurableObjectStorage,
  WorkerWebSocket,
} from './cloudflare-types';
export { WORKER_WS_OPEN, WORKER_WS_CLOSED } from './cloudflare-types';

export {
  GroupRelayChannel,
  RelayError,
  type Participant,
  type RelayErrorCode,
} from './relay-protocol';

export {
  SessionStore,
  InMemoryKv,
  type TokenRecord,
  type SessionStoreOptions,
} from './session-store';

export {
  validateBatch,
  IngestError,
  type IngestRejection,
  type ValidatedBatch,
} from './ingest';
