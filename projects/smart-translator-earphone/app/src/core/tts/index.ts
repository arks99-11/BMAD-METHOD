/**
 * Public surface of the core/tts module (Epic 4).
 */

export {
  TtsError,
  type TtsAudioFormat,
  type TtsEngine,
  type TtsErrorCode,
  type TtsProvider,
  type TtsRequest,
  type TtsResult,
  type TtsStream,
  type TtsStreamChunkEvent,
  type TtsStreamErrorEvent,
  type TtsStreamEvent,
  type TtsStreamFinalEvent,
  type TtsStreamListener,
} from './tts-types';

export { concatChunks, wrapAsTtsStream } from './base-tts-provider';

export {
  ElevenLabsProvider,
  type ElevenLabsProviderOptions,
} from './elevenlabs-provider';

export {
  AzureTtsProvider,
  buildSsml,
  type AzureTtsProviderOptions,
} from './azure-tts-provider';
