/**
 * Story 10.1 — Telemetry event taxonomy and contracts.
 *
 * Telemetry feeds the engine-router transparency sheet (Story 5.4)
 * and the analytics dashboard (PostHog in v1, per architecture
 * §3.10). All events are anonymised: there is no `userId`, only an
 * opt-in `installId`. Free-text fields are dropped at the sink
 * boundary; only enums and numbers leak.
 *
 * The user gates telemetry through `Settings.privacy.telemetryOptIn`
 * (Story 7.3). When opted out, the sink is a no-op `NullTelemetrySink`.
 */

/** Stable event names. Renaming requires a dashboard migration. */
export type TelemetryEventName =
  | 'session.start'
  | 'session.end'
  | 'turn.partial'
  | 'turn.final'
  | 'engine.route'
  | 'engine.fallback'
  | 'engine.error'
  | 'pack.install'
  | 'pack.failed'
  | 'tts.cancelled'
  | 'app.foreground'
  | 'app.background';

export interface TelemetryEvent {
  name: TelemetryEventName;
  /** ms epoch wall-clock. */
  ts: number;
  /** Per-event tags; values must be enums or numbers. */
  tags: Readonly<Record<string, string | number | boolean>>;
}

export interface TelemetrySink {
  /** Append a single event. Implementations buffer/flush themselves. */
  capture(event: TelemetryEvent): void;
  /** Force-flush buffered events; resolves once the network call settles. */
  flush(): Promise<void>;
  /** Drop buffered events without sending. */
  reset(): void;
}
