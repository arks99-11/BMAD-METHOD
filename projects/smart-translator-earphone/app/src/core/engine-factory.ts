/**
 * Convenience factory that wires together default providers based on the
 * available environment variables and the user's selected engine ids.
 *
 * - If the relevant API key is missing, the corresponding cloud provider is
 *   silently dropped and the mock provider takes its place. This is what
 *   makes "demo mode" Just Work when no `.env` is present.
 *
 * - Mock providers always come last in the chain so they act as the final
 *   fallback if a cloud provider transiently fails.
 */

import { hasEnv, getEnv } from '../config/env';
import { DEFAULT_CONFIG } from '../config/default-config';
import type { AudioCaptureProvider } from './audio/audio-capture';
import type { AudioPlaybackProvider } from './audio/audio-playback';
import {
  EngineRouter,
  type EngineRouterOptions,
  type SessionStatus,
} from './engine-router';
import { MockSttProvider } from './stt/mock-stt-provider';
import { GoogleSttProvider } from './stt/google-stt-provider';
import { WhisperCloudProvider } from './stt/whisper-cloud-provider';
import type { SttEngineId, SttProvider } from './stt/stt-types';
import { MockTranslationProvider } from './translation/mock-translation-provider';
import { DeeplProvider } from './translation/deepl-provider';
import { OpenAiTranslationProvider } from './translation/openai-provider';
import { GoogleTranslateProvider } from './translation/google-translate-provider';
import { GoogleTranslateFreeProvider } from './translation/google-translate-free-provider';
import type { TranslationEngineId, TranslationProvider } from './translation/translation-types';
import { MockTtsProvider } from './tts/mock-tts-provider';
import { AzureTtsProvider } from './tts/azure-tts-provider';
import { GoogleTtsProvider } from './tts/google-tts-provider';
import type { TtsEngineId, TtsProvider } from './tts/tts-types';
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from './tts/voice-settings';

export interface EngineFactoryOptions {
  capture: AudioCaptureProvider;
  playback: AudioPlaybackProvider;
  sourceLang?: string | 'auto';
  targetLang?: string;
  voice?: VoiceSettings;
  speakOutput?: boolean;
  sttEngine?: SttEngineId;
  translationEngine?: TranslationEngineId;
  ttsEngine?: TtsEngineId;
}

export function createEngineRouter(options: EngineFactoryOptions): EngineRouter {
  const sttProviders = buildSttProviders(options.sttEngine ?? DEFAULT_CONFIG.defaultSttEngine);
  const translationProviders = buildTranslationProviders(
    options.translationEngine ?? DEFAULT_CONFIG.defaultTranslationEngine,
  );
  const ttsProviders = buildTtsProviders(options.ttsEngine ?? DEFAULT_CONFIG.defaultTtsEngine);

  const router = new EngineRouter({
    capture: options.capture,
    playback: options.playback,
    stt: { providers: sttProviders, sessionDefaults: { sourceLang: options.sourceLang ?? 'auto' } },
    translation: { providers: translationProviders },
    tts: { providers: ttsProviders },
    sourceLang: options.sourceLang ?? 'auto',
    targetLang: options.targetLang ?? DEFAULT_CONFIG.defaultTargetLang,
    voice: options.voice ?? DEFAULT_VOICE_SETTINGS,
    speakOutput: options.speakOutput,
  } satisfies EngineRouterOptions);
  return router;
}

function buildSttProviders(preferred: SttEngineId): SttProvider[] {
  const providers: SttProvider[] = [];
  const cloud: SttProvider[] = [];
  if (hasEnv('EXPO_PUBLIC_OPENAI_API_KEY')) {
    cloud.push(new WhisperCloudProvider({ apiKey: getEnv('EXPO_PUBLIC_OPENAI_API_KEY')! }));
  }
  if (hasEnv('EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY')) {
    cloud.push(new GoogleSttProvider({ apiKey: getEnv('EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY')! }));
  }
  // Reorder so the user's preferred engine (if available) comes first.
  const preferredIx = cloud.findIndex((p) => p.id === preferred);
  if (preferredIx > 0) {
    const [picked] = cloud.splice(preferredIx, 1);
    cloud.unshift(picked!);
  }
  providers.push(...cloud);
  providers.push(new MockSttProvider());
  return providers;
}

function buildTranslationProviders(preferred: TranslationEngineId): TranslationProvider[] {
  const providers: TranslationProvider[] = [];
  const cloud: TranslationProvider[] = [];
  if (hasEnv('EXPO_PUBLIC_DEEPL_API_KEY')) {
    cloud.push(new DeeplProvider({ apiKey: getEnv('EXPO_PUBLIC_DEEPL_API_KEY')! }));
  }
  if (hasEnv('EXPO_PUBLIC_OPENAI_API_KEY')) {
    cloud.push(new OpenAiTranslationProvider({ apiKey: getEnv('EXPO_PUBLIC_OPENAI_API_KEY')! }));
  }
  if (hasEnv('EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY')) {
    cloud.push(new GoogleTranslateProvider({ apiKey: getEnv('EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY')! }));
  }
  const preferredIx = cloud.findIndex((p) => p.id === preferred);
  if (preferredIx > 0) {
    const [picked] = cloud.splice(preferredIx, 1);
    cloud.unshift(picked!);
  }
  providers.push(...cloud);
  // Free unofficial Google endpoint — no API key required, used as a real
  // translation fallback before the deterministic Mock provider so the demo
  // produces real translations out of the box.
  if (!hasEnv('EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY')) {
    providers.push(new GoogleTranslateFreeProvider());
  }
  providers.push(new MockTranslationProvider());
  return providers;
}

function buildTtsProviders(preferred: TtsEngineId): TtsProvider[] {
  const providers: TtsProvider[] = [];
  const cloud: TtsProvider[] = [];
  if (hasEnv('EXPO_PUBLIC_AZURE_TTS_KEY')) {
    cloud.push(
      new AzureTtsProvider({
        apiKey: getEnv('EXPO_PUBLIC_AZURE_TTS_KEY')!,
        region: getEnv('EXPO_PUBLIC_AZURE_TTS_REGION') ?? 'westus',
      }),
    );
  }
  if (hasEnv('EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY')) {
    cloud.push(new GoogleTtsProvider({ apiKey: getEnv('EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY')! }));
  }
  const preferredIx = cloud.findIndex((p) => p.id === preferred);
  if (preferredIx > 0) {
    const [picked] = cloud.splice(preferredIx, 1);
    cloud.unshift(picked!);
  }
  providers.push(...cloud);
  providers.push(new MockTtsProvider());
  return providers;
}

export type { SessionStatus };
