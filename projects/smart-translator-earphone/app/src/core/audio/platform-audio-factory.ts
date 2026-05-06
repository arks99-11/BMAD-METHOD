/**
 * Platform-aware factory: returns the correct AudioCaptureProvider and
 * AudioPlaybackProvider for the current platform.
 *
 *   - Web (Platform.OS === 'web') → WebAudioCaptureProvider + ExpoAudioPlaybackProvider (web branch)
 *   - iOS / Android               → ExpoAudioCaptureProvider + ExpoAudioPlaybackProvider (native branch)
 *   - Pure Node tests (no Platform): fall back to mock providers, so unit
 *     tests of the engine router can run without any platform surface.
 *
 * NOTE: Platform-specific files are loaded with CommonJS `require` so they
 * stay out of the test bundle's import graph (where `react-native`/`expo-av`
 * are not installed). This is deliberate — the eslint exemption sits next to
 * each call.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

import type { AudioCaptureProvider } from './audio-capture';
import type { AudioPlaybackProvider } from './audio-playback';
import { MockAudioCaptureProvider } from './audio-capture';
import { MockAudioPlaybackProvider } from './audio-playback';

let cachedPlatformOs: string | null | undefined = undefined;

function detectPlatformOs(): string | null {
  if (cachedPlatformOs !== undefined) return cachedPlatformOs;
  try {
    const Platform = require('react-native').Platform as { OS: string };
    cachedPlatformOs = Platform?.OS ?? null;
  } catch {
    cachedPlatformOs = null;
  }
  return cachedPlatformOs;
}

export interface CreateAudioCaptureOptions {
  /**
   * On web, pass through to {@link WebAudioCaptureProvider} so the user
   * can pick a non-default microphone (e.g. AirPods, USB mic) via
   * `getUserMedia`. Ignored on native platforms.
   */
  deviceId?: string;
}

export function createAudioCapture(options: CreateAudioCaptureOptions = {}): AudioCaptureProvider {
  const os = detectPlatformOs();
  if (os === 'web') {
    const { WebAudioCaptureProvider } = require('./web-audio-capture');
    return new WebAudioCaptureProvider({ deviceId: options.deviceId });
  }
  if (os === 'ios' || os === 'android') {
    const { ExpoAudioCaptureProvider } = require('./expo-audio-capture');
    return new ExpoAudioCaptureProvider();
  }
  return new MockAudioCaptureProvider();
}

export function createAudioPlayback(): AudioPlaybackProvider {
  const os = detectPlatformOs();
  if (os === 'web' || os === 'ios' || os === 'android') {
    const { ExpoAudioPlaybackProvider } = require('./expo-audio-playback');
    return new ExpoAudioPlaybackProvider();
  }
  return new MockAudioPlaybackProvider();
}

/**
 * Tab / system audio capture. Web-only: native iOS/Android do not allow
 * third-party apps to capture system audio (Apple blocks entirely; Android
 * `AudioPlaybackCapture` requires per-app opt-in and is rarely usable in
 * practice for streaming apps). On native platforms this returns a Mock
 * provider so callers can detect "not supported" via a feature check
 * rather than a runtime crash.
 */
export function createTabAudioCapture(): AudioCaptureProvider {
  const os = detectPlatformOs();
  if (os === 'web') {
    const { WebTabAudioCaptureProvider } = require('./web-tab-audio-capture');
    return new WebTabAudioCaptureProvider();
  }
  return new MockAudioCaptureProvider();
}
