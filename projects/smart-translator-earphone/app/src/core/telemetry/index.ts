/**
 * Public surface of the core/telemetry module (Story 10.1).
 */

export type {
  TelemetryEventName,
  TelemetryEvent,
  TelemetrySink,
} from './telemetry-types';

export { NullTelemetrySink } from './null-sink';
export {
  BufferedTelemetrySink,
  type TelemetryUploader,
  type BufferedTelemetrySinkOptions,
} from './buffered-sink';
