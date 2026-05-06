/**
 * Story 10.3 — Crash reporting contracts.
 *
 * The native crash reporter (Sentry, Bugsnag, Firebase Crashlytics)
 * lives in the RN shell. Application code uses this interface so it
 * can attach breadcrumbs and report handled errors without depending
 * on the platform SDK.
 *
 * Privacy: free-text fields are NOT included in breadcrumbs by
 * default. If a caller passes `data`, the implementation MUST either
 * scrub it or drop it when telemetry is opted out.
 */

export type CrashSeverity = 'info' | 'warning' | 'error' | 'fatal';

export interface Breadcrumb {
  category: string;
  message: string;
  /** Optional structured tags; same constraints as telemetry. */
  data?: Readonly<Record<string, string | number | boolean>>;
  ts: number;
  severity?: CrashSeverity;
}

export interface CrashReporter {
  /** Add a breadcrumb to the next crash report. */
  addBreadcrumb(crumb: Breadcrumb): void;
  /** Report a handled error. */
  captureException(error: Error, severity?: CrashSeverity): void;
  /** Report a fatal/unhandled state to the user. */
  captureFatal(error: Error): void;
  /** Set or clear the user-id tag (anonymised installId, NOT the auth user). */
  setInstallId(installId: string | undefined): void;
}
