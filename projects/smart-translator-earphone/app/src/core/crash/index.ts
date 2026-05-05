/**
 * Public surface of the core/crash module (Story 10.3).
 */

export type {
  CrashSeverity,
  Breadcrumb,
  CrashReporter,
} from './crash-types';

export { NullCrashReporter } from './null-reporter';
