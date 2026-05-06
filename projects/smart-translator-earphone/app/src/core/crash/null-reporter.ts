/**
 * Story 10.3 — No-op crash reporter.
 *
 * Used when telemetry is opted out (Story 7.3). Every method is a
 * deliberate no-op so app code can call them unconditionally.
 */

import type { Breadcrumb, CrashReporter, CrashSeverity } from './crash-types';

export class NullCrashReporter implements CrashReporter {
  addBreadcrumb(_crumb: Breadcrumb): void {
    // no-op
  }

  captureException(_error: Error, _severity?: CrashSeverity): void {
    // no-op
  }

  captureFatal(_error: Error): void {
    // no-op
  }

  setInstallId(_installId: string | undefined): void {
    // no-op
  }
}
