import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isTabAudioCaptureSupported } from '../core/audio/web-tab-audio-capture';
import { sessionStore, useSessionStore } from '../state/useSessionStore';
import { COLORS } from '../theme/colors';

/**
 * Lets the user choose between microphone capture and tab/system-audio
 * capture as the source feeding the translation pipeline.
 *
 * - **Microphone**: default OS input device (mic on phone, headset, etc.).
 * - **Tab audio**: web-only — captures audio from another browser tab via
 *   `getDisplayMedia()`. Useful for translating videos or web calls
 *   without routing the speaker through a microphone.
 *
 * The "Tab audio" tile is disabled on platforms that don't support
 * `getDisplayMedia` (native iOS/Android, older browsers).
 */
export function InputSourcePicker() {
  const state = useSessionStore();
  const [tabSupported, setTabSupported] = useState(false);

  useEffect(() => {
    setTabSupported(isTabAudioCaptureSupported());
  }, []);

  const sessionActive = state.status === 'active' || state.status === 'starting';

  function pick(source: 'mic' | 'tab') {
    if (sessionActive) return;
    try {
      sessionStore.setInputSource(source);
    } catch {
      // Ignore — UI guard above should prevent this, but the store also
      // throws if a session is unexpectedly active.
    }
  }

  return (
    <View style={styles.container} accessibilityRole="radiogroup">
      <Text style={styles.label}>Audio source</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.tile, state.inputSource === 'mic' && styles.tileActive]}
          onPress={() => pick('mic')}
          disabled={sessionActive}
          accessibilityRole="radio"
          accessibilityState={{ selected: state.inputSource === 'mic', disabled: sessionActive }}
        >
          <Text style={styles.tileTitle}>🎙  Microphone</Text>
          <Text style={styles.tileDesc}>Default OS input · phone mic, headset, etc.</Text>
        </Pressable>
        <Pressable
          style={[
            styles.tile,
            state.inputSource === 'tab' && styles.tileActive,
            (!tabSupported || sessionActive) && styles.tileDisabled,
          ]}
          onPress={() => pick('tab')}
          disabled={!tabSupported || sessionActive}
          accessibilityRole="radio"
          accessibilityState={{
            selected: state.inputSource === 'tab',
            disabled: !tabSupported || sessionActive,
          }}
        >
          <Text style={styles.tileTitle}>📺  Tab audio</Text>
          <Text style={styles.tileDesc}>
            {tabSupported
              ? 'Capture another tab (YouTube, calls). Web-only.'
              : 'Not supported on this device'}
          </Text>
        </Pressable>
      </View>
      {sessionActive ? (
        <Text style={styles.hint}>Stop the current session to change the audio source.</Text>
      ) : null}
    </View>
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
  row: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  tileActive: { borderColor: COLORS.primary, backgroundColor: COLORS.surfaceMuted },
  tileDisabled: { opacity: 0.45 },
  tileTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  tileDesc: { color: COLORS.textMuted, fontSize: 11 },
  hint: { color: COLORS.textMuted, fontSize: 11, fontStyle: 'italic' },
});
