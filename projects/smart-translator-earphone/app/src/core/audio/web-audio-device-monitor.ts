/**
 * Web implementation of `AudioDeviceMonitor`.
 *
 * Uses `navigator.mediaDevices.enumerateDevices()` to list audio outputs
 * and `mediaDevices.addEventListener('devicechange', ...)` for hot-plug
 * detection.
 *
 * Notes:
 *   - Without microphone permission, browsers return entries with empty
 *     `label` strings. We still report them by `deviceId` so the UI shows
 *     "(N devices)" even before the user grants access.
 *   - On Chrome/Edge audio outputs are listed as `audiooutput` kind; on
 *     Safari only `audioinput` is exposed. We probe both kinds and prefer
 *     `audiooutput` when available, falling back to `audioinput` otherwise.
 *   - Bluetooth detection is heuristic (label-based via `classifyDeviceLabel`).
 */

import {
  type AudioDeviceInfo,
  type AudioDeviceKind,
  type AudioDeviceListener,
  type AudioDeviceMonitor,
  type AudioDeviceSnapshot,
  classifyDeviceLabel,
} from './audio-device-monitor';

interface WebMediaDevicesGlobals {
  navigator?: {
    mediaDevices?: MediaDevices & {
      addEventListener?: (type: 'devicechange', listener: () => void) => void;
      removeEventListener?: (type: 'devicechange', listener: () => void) => void;
    };
  };
}

const EMPTY: AudioDeviceSnapshot = { devices: [], active: null, hasEarphone: false };

export class WebAudioDeviceMonitor implements AudioDeviceMonitor {
  private snapshot: AudioDeviceSnapshot = EMPTY;
  private readonly listeners = new Set<AudioDeviceListener>();
  private readonly devicechangeHandler = () => {
    void this.refresh();
  };
  private started = false;

  async start(): Promise<AudioDeviceSnapshot> {
    if (this.started) return this.snapshot;
    const md = (globalThis as unknown as WebMediaDevicesGlobals).navigator?.mediaDevices;
    if (!md?.enumerateDevices) {
      this.snapshot = EMPTY;
      return EMPTY;
    }
    md.addEventListener?.('devicechange', this.devicechangeHandler);
    this.started = true;
    await this.refresh();
    return this.snapshot;
  }

  stop(): void {
    if (!this.started) return;
    const md = (globalThis as unknown as WebMediaDevicesGlobals).navigator?.mediaDevices;
    md?.removeEventListener?.('devicechange', this.devicechangeHandler);
    this.started = false;
  }

  current(): AudioDeviceSnapshot {
    return this.snapshot;
  }

  on(listener: AudioDeviceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async refresh(): Promise<void> {
    const md = (globalThis as unknown as WebMediaDevicesGlobals).navigator?.mediaDevices;
    if (!md?.enumerateDevices) {
      this.emit(EMPTY);
      return;
    }
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await md.enumerateDevices();
    } catch {
      this.emit(EMPTY);
      return;
    }
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const pool = outputs.length > 0 ? outputs : inputs;
    const mapped: AudioDeviceInfo[] = pool.map((d) => ({
      id: d.deviceId || `${d.kind}-${d.groupId}`,
      label: d.label,
      kind: classifyDeviceLabel(d.label),
    }));
    const hasEarphone = mapped.some((d) => d.kind === 'bluetooth' || d.kind === 'wired');
    const active = pickActive(mapped);
    this.emit({ devices: mapped, active, hasEarphone });
  }

  private emit(snapshot: AudioDeviceSnapshot): void {
    this.snapshot = snapshot;
    for (const l of this.listeners) l(snapshot);
  }
}

function pickActive(devices: AudioDeviceInfo[]): AudioDeviceInfo | null {
  if (devices.length === 0) return null;
  // Prefer the first non-speaker device — wired/bluetooth take precedence over
  // the built-in speaker, which is the iOS/Android default-route convention.
  const priority: AudioDeviceKind[] = ['bluetooth', 'wired', 'unknown', 'speaker'];
  for (const kind of priority) {
    const found = devices.find((d) => d.kind === kind);
    if (found) return found;
  }
  return devices[0] ?? null;
}
