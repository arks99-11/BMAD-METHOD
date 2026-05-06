/**
 * Epic 11 — Telemetry ingest validator.
 *
 * The Worker exposes `POST /events` for the buffered telemetry sink
 * (Story 10.1). This module validates an incoming JSON body against
 * the strict telemetry schema before forwarding upstream (PostHog).
 *
 * Why a dedicated validator?
 *   - Belt-and-braces: clients are always typed, but a malicious
 *     mod could ship arbitrary JSON. The Worker MUST reject any
 *     payload that contains values outside the enum / number /
 *     boolean envelope (Story 10.2).
 *   - Drops fields the dashboard doesn't recognise so a renamed
 *     event upstream doesn't poison the funnel.
 */

import type { TelemetryEvent, TelemetryEventName } from '../core/telemetry/telemetry-types';

const ALLOWED_EVENT_NAMES: ReadonlySet<TelemetryEventName> = new Set<TelemetryEventName>([
  'session.start',
  'session.end',
  'turn.partial',
  'turn.final',
  'engine.route',
  'engine.fallback',
  'engine.error',
  'pack.install',
  'pack.failed',
  'tts.cancelled',
  'app.foreground',
  'app.background',
]);

export type IngestRejection =
  | 'not-an-object'
  | 'not-an-array'
  | 'unknown-event-name'
  | 'invalid-ts'
  | 'invalid-tag-value'
  | 'too-many-events';

export interface ValidatedBatch {
  events: TelemetryEvent[];
}

/**
 * Validate a batch payload (`{ events: [...] }`). Drops invalid
 * events and returns a `rejections` count for ingest telemetry.
 * Throws only on top-level shape violations.
 */
export function validateBatch(
  body: unknown,
  options: { maxBatchSize?: number } = {},
): { batch: ValidatedBatch; rejections: Array<{ index: number; reason: IngestRejection }> } {
  const maxBatchSize = options.maxBatchSize ?? 200;
  if (typeof body !== 'object' || body === null) {
    throw new IngestError('not-an-object');
  }
  const root = body as { events?: unknown };
  if (!Array.isArray(root.events)) {
    throw new IngestError('not-an-array');
  }
  if (root.events.length > maxBatchSize) {
    throw new IngestError('too-many-events');
  }

  const ok: TelemetryEvent[] = [];
  const rejections: Array<{ index: number; reason: IngestRejection }> = [];
  for (let i = 0; i < root.events.length; i += 1) {
    const reason = validateEvent(root.events[i]);
    if (typeof reason === 'string') {
      rejections.push({ index: i, reason });
    } else {
      ok.push(reason);
    }
  }
  return { batch: { events: ok }, rejections };
}

function validateEvent(value: unknown): TelemetryEvent | IngestRejection {
  if (typeof value !== 'object' || value === null) return 'not-an-object';
  const ev = value as { name?: unknown; ts?: unknown; tags?: unknown };
  if (typeof ev.name !== 'string' || !ALLOWED_EVENT_NAMES.has(ev.name as TelemetryEventName)) {
    return 'unknown-event-name';
  }
  if (typeof ev.ts !== 'number' || !Number.isFinite(ev.ts) || ev.ts < 0) {
    return 'invalid-ts';
  }
  if (typeof ev.tags !== 'object' || ev.tags === null) {
    return 'invalid-tag-value';
  }
  const cleanTags: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(ev.tags)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      cleanTags[k] = v;
    } else {
      return 'invalid-tag-value';
    }
  }
  return {
    name: ev.name as TelemetryEventName,
    ts: ev.ts,
    tags: cleanTags,
  };
}

export class IngestError extends Error {
  constructor(public readonly code: IngestRejection) {
    super(code);
    this.name = 'IngestError';
  }
}
