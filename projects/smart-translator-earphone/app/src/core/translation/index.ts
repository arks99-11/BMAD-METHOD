/**
 * Public surface of the core/translation module (Epic 3).
 */

export * from './translation-types';
export { MockTranslationProvider } from './mock-translation-provider';
export { DeeplProvider, type DeeplOptions } from './deepl-provider';
export { OpenAiTranslationProvider, type OpenAiTranslationOptions } from './openai-provider';
export { GoogleTranslateProvider, type GoogleTranslateOptions } from './google-translate-provider';
export {
  GoogleTranslateFreeProvider,
  type GoogleTranslateFreeOptions,
} from './google-translate-free-provider';
export { TranslationRouter, type TranslationRouterOptions } from './translation-router';
