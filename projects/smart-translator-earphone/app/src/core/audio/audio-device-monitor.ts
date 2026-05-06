/**
 * Audio device / earphone connection monitor.
 *
 * Cross-platform contract for detecting audio output devices and changes:
 *   - Wired headphones plugged / unplugged.
 *   - Bluetooth headset connected / disconnected.
 *   - Default speaker fallback.
 *
 * The web implementation lives in `web-audio-device-monitor.ts` (uses
 * `navigator.mediaDevices.enumerateDevices()` + `devicechange` event).
 * The native iOS / Android implementations live behind the React Native
 * turbo-module bridge (AVAudioSession route-change notifications +
 * AudioManager.AudioDeviceCallback).
 */

export type AudioDeviceKind = 'bluetooth' | 'wired' | 'speaker' | 'unknown';

export interface AudioDeviceInfo {
  /** Stable identifier from the platform (deviceId on web, UID on iOS, id on Android). */
  id: string;
  /** Human-readable label. May be empty if mic permission has not been granted on web. */
  label: string;
  /** Coarse classification used by the UI to pick an icon. */
  kind: AudioDeviceKind;
}

export interface AudioDeviceSnapshot {
  /** All known audio output devices at the time of the snapshot. */
  devices: AudioDeviceInfo[];
  /** Currently active output route (or null if unknown). */
  active: AudioDeviceInfo | null;
  /** True if the platform reports any non-speaker device (wired or Bluetooth). */
  hasEarphone: boolean;
}

export type AudioDeviceListener = (snapshot: AudioDeviceSnapshot) => void;

export interface AudioDeviceMonitor {
  /** Begin watching for device changes. Resolves once the initial snapshot is available. */
  start(): Promise<AudioDeviceSnapshot>;
  /** Stop watching. Does not throw if already stopped. */
  stop(): void;
  /** Current best-known snapshot. */
  current(): AudioDeviceSnapshot;
  /** Subscribe to changes. Returns an unsubscribe function. */
  on(listener: AudioDeviceListener): () => void;
}

const BLUETOOTH_HINTS = [
  'bluetooth',
  'airpods',
  'buds',
  'beats',
  'headset',
  'wf-',
  'wh-',
  'jabra',
  'bose',
  'sony',
];

const WIRED_HINTS = ['wired', 'headphone', 'earphone', 'headset', 'jack', 'usb', 'lightning'];

const SPEAKER_HINTS = ['speaker', 'built-in', 'internal', 'default'];

/**
 * Heuristic classifier — labels are platform-dependent and locale-dependent
 * so we score by substring hints rather than exact match.
 */
export function classifyDeviceLabel(rawLabel: string): AudioDeviceKind {
  const label = rawLabel.toLowerCase();
  if (!label) return 'unknown';
  for (const hint of BLUETOOTH_HINTS) if (label.includes(hint)) return 'bluetooth';
  for (const hint of WIRED_HINTS) if (label.includes(hint)) return 'wired';
  for (const hint of SPEAKER_HINTS) if (label.includes(hint)) return 'speaker';
  return 'unknown';
}

/**
 * Fallback monitor used when no platform implementation is available
 * (e.g. unit tests, server-side rendering). Reports an empty snapshot
 * and never fires.
 */
export class NullAudioDeviceMonitor implements AudioDeviceMonitor {
  private snapshot: AudioDeviceSnapshot = { devices: [], active: null, hasEarphone: false };

  async start(): Promise<AudioDeviceSnapshot> {
    return this.snapshot;
  }

  stop(): void {
    /* no-op */
  }

  current(): AudioDeviceSnapshot {
    return this.snapshot;
  }

  on(_listener: AudioDeviceListener): () => void {
    return () => {
      /* no-op */
    };
  }
}
