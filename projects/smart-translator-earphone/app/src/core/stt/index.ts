/**
 * Public surface of the core/stt module (Epic 2).
 *
 * Importers should use the absolute path `@core/stt` (configured in
 * tsconfig paths once the RN shell exists) and not reach into individual
 * files; this barrel is the stable contract.
 *
 * Adapters currently exposed:
 *   - DeepgramProvider          (Story 2.1, cloud, WebSocket)
 *   - GoogleSttProvider         (Story 2.2, cloud, REST recognise)
 *
 * Future adapters wired by subsequent PRs:
 *   - WhisperOnDeviceProvider   (Story 2.3a interface; 2.3b runtime)
 *   - MockSttProvider           (Story 2.3a deterministic test adapter)
 *   - SttEngineRouter           (Story 2.5)
 */

export type {
  SttEngine,
  SttErrorCode,
  SttEvent,
  SttEventListener,
  SttProvider,
  SttSession,
  SttStartOptions,
} from './stt-types';

export {
  DeepgramProvider,
  type DeepgramProviderOptions,
  type WebSocketFactory,
  type WebSocketLike,
} from './deepgram-provider';

export {
  GoogleSttProvider,
  GoogleSttHttpError,
  RestGoogleSttTransport,
  int16ToBase64,
  GOOGLE_STT_ENCODING,
  GOOGLE_STT_SAMPLE_RATE,
  type GoogleSttMode,
  type GoogleSttProviderOptions,
  type GoogleSttRecognizeRequest,
  type GoogleSttResult,
  type GoogleSttResultAlternative,
  type GoogleSttTransport,
  type RestGoogleSttTransportOptions,
} from './google-stt-provider';

export {
  LanguageDetectionPolicy,
  type DetectionResult,
  type DetectionResultKind,
  type DetectionResultListener,
  type LanguageDetectionPolicyOptions,
} from './language-detection';
