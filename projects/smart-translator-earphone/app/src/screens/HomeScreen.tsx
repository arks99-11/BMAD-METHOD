import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AudioDeviceStatus } from '../components/AudioDeviceStatus';
import { InputSourcePicker } from '../components/InputSourcePicker';
import { LanguagePicker } from '../components/LanguagePicker';
import { MicSourcePicker } from '../components/MicSourcePicker';
import { sessionStore, useSessionStore } from '../state/useSessionStore';
import { COLORS } from '../theme/colors';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const state = useSessionStore();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Smart Translator</Text>
        <Text style={styles.subtitle}>Real-time speech translation for your earphones</Text>
      </View>

      <AudioDeviceStatus />

      <InputSourcePicker />

      <MicSourcePicker />

      <View style={styles.languageRow}>
        <LanguagePicker
          label="From"
          value={state.sourceLang}
          includeAuto
          onChange={(lang) => sessionStore.setSourceLang(lang)}
        />
        <View style={styles.arrow}>
          <Text style={styles.arrowText}>→</Text>
        </View>
        <LanguagePicker
          label="To"
          value={state.targetLang}
          onChange={(lang) => sessionStore.setTargetLang(lang === 'auto' ? state.targetLang : lang)}
        />
      </View>

      <View style={styles.modes}>
        <Text style={styles.sectionLabel}>Mode</Text>
        <View style={styles.modeButtons}>
          <Pressable
            style={[styles.modeButton, state.mode === 'conversation' && styles.modeButtonActive]}
            onPress={() => {
              sessionStore.setMode('conversation');
              navigation.navigate('Conversation');
            }}
          >
            <Text style={styles.modeTitle}>Conversation</Text>
            <Text style={styles.modeDescription}>Two speakers · spoken playback</Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, state.mode === 'lecture' && styles.modeButtonActive]}
            onPress={() => {
              sessionStore.setMode('lecture');
              navigation.navigate('Lecture');
            }}
          >
            <Text style={styles.modeTitle}>Lecture</Text>
            <Text style={styles.modeDescription}>Single speaker · silent transcript</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={styles.bigStartButton}
        onPress={() => {
          sessionStore.setMode('conversation');
          navigation.navigate('Conversation');
        }}
        accessibilityRole="button"
      >
        <Text style={styles.bigStartText}>Start Translation</Text>
      </Pressable>

      <View style={styles.footer}>
        <Pressable style={styles.footerButton} onPress={() => navigation.navigate('History')}>
          <Text style={styles.footerButtonText}>History</Text>
        </Pressable>
        <Pressable style={styles.footerButton} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.footerButtonText}>Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: 24, gap: 24 },
  header: { paddingTop: 24 },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: COLORS.textMuted, fontSize: 14, marginTop: 4 },
  languageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  arrow: { paddingHorizontal: 4, paddingBottom: 12 },
  arrowText: { color: COLORS.textMuted, fontSize: 18 },
  modes: { gap: 8 },
  sectionLabel: { color: COLORS.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  modeButtons: { flexDirection: 'row', gap: 12 },
  modeButton: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  modeButtonActive: { borderColor: COLORS.primary, backgroundColor: COLORS.surfaceMuted },
  modeTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  modeDescription: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  bigStartButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 12,
  },
  bigStartText: { color: '#0c1424', fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 'auto' },
  footerButton: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  footerButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
});
