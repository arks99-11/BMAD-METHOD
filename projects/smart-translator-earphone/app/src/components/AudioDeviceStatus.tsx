import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  type AudioDeviceMonitor,
  type AudioDeviceSnapshot,
  NullAudioDeviceMonitor,
  WebAudioDeviceMonitor,
} from '../core/audio';
import { COLORS } from '../theme/colors';

const ICON_FOR_KIND: Record<string, string> = {
  bluetooth: '🎧',
  wired: '🎧',
  speaker: '🔊',
  unknown: '🎙️',
};

function createMonitor(): AudioDeviceMonitor {
  if (Platform.OS === 'web') return new WebAudioDeviceMonitor();
  // Native iOS / Android implementations land alongside the AudioSession
  // turbo module (Stories 1.6 / 1.7); until then the null monitor keeps
  // the UI honest about the lack of a route signal on those platforms.
  return new NullAudioDeviceMonitor();
}

interface AudioDeviceStatusProps {
  /** Override the monitor (used in tests / Storybook). */
  monitorOverride?: AudioDeviceMonitor;
}

export function AudioDeviceStatus({ monitorOverride }: AudioDeviceStatusProps) {
  const [snapshot, setSnapshot] = useState<AudioDeviceSnapshot>({
    devices: [],
    active: null,
    hasEarphone: false,
  });
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [needsLabelPermission, setNeedsLabelPermission] = useState(false);

  useEffect(() => {
    const monitor = monitorOverride ?? createMonitor();
    let cancelled = false;
    const off = monitor.on((snap) => {
      if (!cancelled) setSnapshot(snap);
    });
    monitor
      .start()
      .then((snap) => {
        if (cancelled) return;
        setSnapshot(snap);
        if (snap.devices.length > 0 && snap.devices.every((d) => !d.label)) {
          setNeedsLabelPermission(true);
        }
      })
      .catch(() => {
        // already handled by the monitor's internal try/catch
      });
    return () => {
      cancelled = true;
      off();
      monitor.stop();
    };
  }, [monitorOverride]);

  async function requestLabelAccess(): Promise<void> {
    if (Platform.OS !== 'web') return;
    const md = (
      globalThis as unknown as { navigator?: { mediaDevices?: MediaDevices } }
    ).navigator?.mediaDevices;
    if (!md?.getUserMedia) return;
    try {
      const stream = await md.getUserMedia({ audio: true });
      // Immediately release the mic — we only needed the permission so the
      // browser exposes device labels.
      for (const t of stream.getTracks()) t.stop();
      setNeedsLabelPermission(false);
      // Trigger a re-enumeration on the next devicechange tick.
      const monitor = monitorOverride ?? null;
      if (monitor) {
        const snap = await monitor.start();
        setSnapshot(snap);
      }
    } catch {
      setPermissionDenied(true);
    }
  }

  const active = snapshot.active;
  const icon = active ? (ICON_FOR_KIND[active.kind] ?? '🎙️') : '🔇';
  const label = active?.label || activeFallback(snapshot, permissionDenied, needsLabelPermission);
  const dotColor =
    snapshot.hasEarphone || (active && active.kind !== 'unknown') ? COLORS.success : COLORS.warning;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.icon}>{icon}</Text>
        <View style={styles.text}>
          <Text style={styles.title}>{describeKind(active?.kind ?? 'unknown', snapshot)}</Text>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
      {needsLabelPermission && !permissionDenied && (
        <Pressable style={styles.permButton} onPress={requestLabelAccess}>
          <Text style={styles.permButtonText}>Allow microphone to identify devices</Text>
        </Pressable>
      )}
      {permissionDenied && (
        <Text style={styles.permError}>
          Microphone permission denied — device labels unavailable.
        </Text>
      )}
    </View>
  );
}

function describeKind(kind: string, snapshot: AudioDeviceSnapshot): string {
  if (snapshot.devices.length === 0) return 'No audio device';
  switch (kind) {
    case 'bluetooth':
      return 'Bluetooth headset connected';
    case 'wired':
      return 'Wired earphones connected';
    case 'speaker':
      return 'Built-in speaker';
    default:
      return `${snapshot.devices.length} audio device${snapshot.devices.length === 1 ? '' : 's'} detected`;
  }
}

function activeFallback(
  snapshot: AudioDeviceSnapshot,
  denied: boolean,
  needsPermission: boolean,
): string {
  if (snapshot.devices.length === 0) {
    if (Platform.OS === 'web') return 'enumerateDevices() reported no audio devices';
    return 'native AudioSession bridge not yet wired';
  }
  if (denied) return 'permission denied';
  if (needsPermission) return `${snapshot.devices.length} unlabeled device(s)`;
  return `${snapshot.devices.length} device${snapshot.devices.length === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  icon: { fontSize: 22 },
  text: { flex: 1 },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  label: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  permButton: {
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  permButtonText: { color: COLORS.text, fontSize: 12, fontWeight: '500' },
  permError: { color: COLORS.danger, fontSize: 12 },
});
