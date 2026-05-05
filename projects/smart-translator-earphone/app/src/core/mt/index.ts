/**
 * Public surface of the core/mt module (Epic 3).
 */

export {
  MtError,
  type MtEngine,
  type MtErrorCode,
  type MtProvider,
  type MtRequest,
  type MtResult,
  type MtStream,
  type MtStreamChunkEvent,
  type MtStreamErrorEvent,
  type MtStreamEvent,
  type MtStreamFinalEvent,
  type MtStreamListener,
} from './mt-types';

export { wrapAsStream, abortablePromise } from './base-mt-provider';

export { DeeplProvider, type DeeplProviderOptions } from './deepl-provider';

export {
  GoogleMtProvider,
  GoogleMtRestTransport,
  GoogleMtHttpError,
  type GoogleMtProviderOptions,
  type GoogleMtRestTransportOptions,
  type GoogleMtTransport,
  type GoogleTranslateRequest,
  type GoogleTranslateResult,
} from './google-mt-provider';
