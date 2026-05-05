/**
 * Story 10.1 — No-op telemetry sink.
 *
 * Used when `Settings.privacy.telemetryOptIn === false`. Every method
 * is a deliberate no-op so the rest of the app can call `capture()`
 * unconditionally; the privacy decision is enforced here.
 */

import type { TelemetryEvent, TelemetrySink } from './telemetry-types';

export class NullTelemetrySink implements TelemetrySink {
  capture(_event: TelemetryEvent): void {
    // intentionally no-op
  }

  async flush(): Promise<void> {
    // intentionally no-op
  }

  reset(): void {
    // intentionally no-op
  }
}
