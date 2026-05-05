/**
 * Public surface of the core/settings module (Story 7.3).
 */

export {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  type AppSettings,
  type LanguagesSettings,
  type VoicePreferences,
  type PrivacySettings,
  type AudioSettings,
  type AccountSettings,
} from './settings-schema';

export { SettingsManager, type SettingsListener } from './settings-manager';
