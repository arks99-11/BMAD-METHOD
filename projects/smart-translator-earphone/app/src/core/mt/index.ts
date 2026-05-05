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

export {
  OpenAiMtProvider,
  OpenAiHttpTransport,
  OpenAiHttpError,
  type OpenAiMtProviderOptions,
  type OpenAiHttpTransportOptions,
  type OpenAiTransport,
  type OpenAiChatRequest,
  type OpenAiMessage,
} from './openai-mt-provider';

export {
  TranslationOrchestrator,
  type OrchestratorEvent,
  type OrchestratorListener,
  type TranslationOrchestratorOptions,
} from './translation-orchestrator';
