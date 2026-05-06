import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  enumerateAudioInputs,
  type AudioInputDeviceInfo,
} from '../core/audio/web-audio-capture';
import { sessionStore, useSessionStore } from '../state/useSessionStore';
import { COLORS } from '../theme/colors';

/**
 * Lets the user pick which microphone to capture from when `inputSource`
 * is 'mic' on web. Mirrors the Zoom/Discord UX: list of available audio
 * inputs + a "Default" option that defers to the OS.
 *
 * Browsers strip device labels until the user has granted mic permission
 * at least once; we expose a "Grant permission" button that calls
 * `getUserMedia({ audio: true })` once and re-enumerates so labels
 * appear.
 */
export function MicSourcePicker() {
  const state = useSessionStore();
  const [devices, setDevices] = useState<AudioInputDeviceInfo[]>([]);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await enumerateAudioInputs();
    setDevices(list);
    setNeedsPermission(list.length > 0 && list.every((d) => d.label === ''));
  }, []);

  useEffect(() => {
    void refresh();
    // Listen for hot-plug device changes (Bluetooth headset connect/disconnect).
    const md = (
      globalThis as unknown as {
        navigator?: { mediaDevices?: { addEventListener?: typeof EventTarget.prototype.addEventListener; removeEventListener?: typeof EventTarget.prototype.removeEventListener } };
      }
    ).navigator?.mediaDevices;
    if (!md?.addEventListener) return;
    const handler = () => {
      void refresh();
    };
    md.addEventListener('devicechange', handler as EventListener);
    return () => {
      md.removeEventListener?.('devicechange', handler as EventListener);
    };
  }, [refresh]);

  async function grantPermission() {
    setPermissionError(null);
    try {
      const md = (
        globalThis as unknown as {
          navigator?: { mediaDevices?: MediaDevices };
        }
      ).navigator?.mediaDevices;
      if (!md?.getUserMedia) {
        throw new Error('Microphone access is not available in this environment.');
      }
      const stream = await md.getUserMedia({ audio: true });
      // Immediately stop the probe stream — we only wanted the permission grant.
      for (const t of stream.getTracks()) t.stop();
      await refresh();
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : String(err));
    }
  }

  if (state.inputSource !== 'mic') return null;

  const sessionActive = state.status === 'active' || state.status === 'starting';

  function pick(deviceId: string) {
    if (sessionActive) return;
    try {
      sessionStore.setMicDeviceId(deviceId);
    } catch {
      // ignore — UI guard above prevents this in normal flow
    }
  }

  return (
    <View style={styles.container} accessibilityRole="radiogroup">
      <Text style={styles.label}>Microphone</Text>
      {needsPermission ? (
        <View style={styles.permissionRow}>
          <Text style={styles.permissionText}>
            Grant microphone access to see device names
          </Text>
          <Pressable style={styles.permissionButton} onPress={grantPermission}>
            <Text style={styles.permissionButtonText}>Grant access</Text>
          </Pressable>
        </View>
      ) : null}
      {permissionError ? <Text style={styles.errorText}>{permissionError}</Text> : null}
      <ScrollView
        style={styles.list}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      >
        <DeviceTile
          deviceId=""
          label="Default (OS)"
          selected={state.micDeviceId === ''}
          disabled={sessionActive}
          onPress={() => pick('')}
        />
        {devices.map((d) => (
          <DeviceTile
            key={d.deviceId || d.label || d.groupId}
            deviceId={d.deviceId}
            label={d.label || `Microphone (${d.deviceId.slice(0, 8) || 'unknown'})`}
            selected={state.micDeviceId === d.deviceId}
            disabled={sessionActive}
            onPress={() => pick(d.deviceId)}
          />
        ))}
      </ScrollView>
      {sessionActive ? (
        <Text style={styles.hint}>Stop the current session to change the microphone.</Text>
      ) : null}
    </View>
  );
}

interface DeviceTileProps {
  deviceId: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}

function DeviceTile({ deviceId, label, selected, disabled, onPress }: DeviceTileProps) {
  return (
    <Pressable
      style={[styles.tile, selected && styles.tileActive, disabled && styles.tileDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`Microphone ${label}`}
      testID={`mic-tile-${deviceId || 'default'}`}
    >
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: {
    color: COLORS.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  list: { flexGrow: 0 },
  listContent: { gap: 8, paddingRight: 8 },
  tile: {
    minWidth: 140,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tileActive: { borderColor: COLORS.primary, backgroundColor: COLORS.surfaceMuted },
  tileDisabled: { opacity: 0.45 },
  tileLabel: { color: COLORS.text, fontSize: 13, fontWeight: '500' },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  permissionText: { color: COLORS.textMuted, fontSize: 12, flex: 1 },
  permissionButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  permissionButtonText: { color: '#0c1424', fontSize: 12, fontWeight: '600' },
  errorText: { color: '#ff6b6b', fontSize: 11 },
  hint: { color: COLORS.textMuted, fontSize: 11, fontStyle: 'italic' },
});
