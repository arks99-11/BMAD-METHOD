/**
 * Session store — a tiny event-emitter based store that holds:
 *
 *   - The current source / target language and engine selections.
 *   - The current voice settings.
 *   - The active EngineRouter (lazily created).
 *   - A rolling list of transcript + translation entries grouped by speaker.
 *   - Past sessions for the History screen.
 *
 * The store is intentionally not a full Redux/zustand stack — the app's
 * needs are small and a hand-rolled emitter keeps the dependency footprint
 * minimal. Components subscribe via `useSessionStore()` (a React hook in
 * `useSessionStore.ts`) which re-renders on each event.
 */

import { DEFAULT_CONFIG } from '../config/default-config';
import {
  createAudioCapture,
  createAudioPlayback,
  createTabAudioCapture,
} from '../core/audio/platform-audio-factory';
import {
  createEngineRouter,
  type EngineFactoryOptions,
} from '../core/engine-factory';
import type { EngineEvent, EngineRouter, SessionStatus } from '../core/engine-router';
import type { SttEngineId } from '../core/stt/stt-types';
import type { TranslationEngineId } from '../core/translation/translation-types';
import type { TtsEngineId } from '../core/tts/tts-types';
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from '../core/tts/voice-settings';

export type ConversationMode = 'conversation' | 'lecture';

/**
 * Source of audio fed into the pipeline.
 *   - 'mic' (default): the user's microphone (default OS input device).
 *   - 'tab': another tab/window's audio captured via getDisplayMedia. Web
 *     only — on native it falls back to a Mock provider so feature
 *     detection can prevent the option from showing in the UI.
 */
export type AudioInputSource = 'mic' | 'tab';

export interface TranscriptEntry {
  id: string;
  speakerId: string;
  /** Source-language transcript. */
  text: string;
  /** Translation in the target language (filled in once translation completes). */
  translation: string;
  detectedLang?: string;
  status: 'partial' | 'final' | 'translated';
  startedAtMs: number;
}

export interface PastSession {
  id: string;
  startedAt: number;
  endedAt: number;
  sourceLang: string;
  targetLang: string;
  mode: ConversationMode;
  entryCount: number;
  preview: string;
}

export interface SessionState {
  status: SessionStatus;
  mode: ConversationMode;
  inputSource: AudioInputSource;
  /**
   * The selected microphone deviceId on web. Empty string means "use the
   * OS default device". Ignored when inputSource is 'tab' or on native
   * platforms.
   */
  micDeviceId: string;
  sourceLang: string | 'auto';
  targetLang: string;
  sttEngine: SttEngineId;
  translationEngine: TranslationEngineId;
  ttsEngine: TtsEngineId;
  voice: VoiceSettings;
  speakOutput: boolean;
  entries: TranscriptEntry[];
  history: PastSession[];
  errorMessage: string | null;
}

type Listener = (state: SessionState) => void;

const SPEAKER_A = 'A';
const SPEAKER_B = 'B';

let entryCounter = 0;
let sessionCounter = 0;

export class SessionStore {
  private state: SessionState;
  private readonly listeners = new Set<Listener>();
  private engine: EngineRouter | null = null;
  private engineUnsubscribe: (() => void) | null = null;
  private currentSpeaker: typeof SPEAKER_A | typeof SPEAKER_B = SPEAKER_A;
  private currentSessionStartedAt = 0;

  constructor() {
    this.state = {
      status: 'idle',
      mode: 'conversation',
      inputSource: 'mic',
      micDeviceId: '',
      sourceLang: 'auto',
      targetLang: DEFAULT_CONFIG.defaultTargetLang,
      sttEngine: DEFAULT_CONFIG.defaultSttEngine,
      translationEngine: DEFAULT_CONFIG.defaultTranslationEngine,
      ttsEngine: DEFAULT_CONFIG.defaultTtsEngine,
      voice: DEFAULT_VOICE_SETTINGS,
      speakOutput: true,
      entries: [],
      history: [],
      errorMessage: null,
    };
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMode(mode: ConversationMode): void {
    this.update({ mode, speakOutput: mode === 'conversation' });
    this.engine?.setSpeakOutput(mode === 'conversation');
  }

  setSourceLang(lang: string | 'auto'): void {
    this.update({ sourceLang: lang });
    this.engine?.setSourceLanguage(lang);
  }

  setTargetLang(lang: string): void {
    this.update({ targetLang: lang });
    this.engine?.setTargetLanguage(lang);
  }

  setSttEngine(engine: SttEngineId): void {
    this.update({ sttEngine: engine });
    if (this.engine) this.engine.stt.selectEngine(engine);
  }

  setTranslationEngine(engine: TranslationEngineId): void {
    this.update({ translationEngine: engine });
    if (this.engine) this.engine.translation.selectEngine(engine);
  }

  setTtsEngine(engine: TtsEngineId): void {
    this.update({ ttsEngine: engine });
    if (this.engine) this.engine.tts.selectEngine(engine);
  }

  setVoice(voice: VoiceSettings): void {
    this.update({ voice });
    this.engine?.setVoice(voice);
  }

  toggleSpeaker(): void {
    this.currentSpeaker = this.currentSpeaker === SPEAKER_A ? SPEAKER_B : SPEAKER_A;
  }

  setSpeakOutput(speak: boolean): void {
    this.update({ speakOutput: speak });
    this.engine?.setSpeakOutput(speak);
  }

  /**
   * Switch between microphone capture and tab/system-audio capture. The
   * cached engine is dropped so the next `startSession()` rebuilds it with
   * the new capture provider.
   *
   * Throws if a session is currently active — callers should `stopSession()`
   * first.
   */
  setInputSource(source: AudioInputSource): void {
    if (this.state.status === 'active' || this.state.status === 'starting') {
      throw new Error('Stop the current session before changing the input source.');
    }
    if (this.state.inputSource === source) return;
    this.update({ inputSource: source });
    this.invalidateEngine();
  }

  /**
   * Choose which microphone to capture from. Empty string selects the OS
   * default. Takes effect on the next `startSession()`. Throws if a
   * session is currently active.
   */
  setMicDeviceId(deviceId: string): void {
    if (this.state.status === 'active' || this.state.status === 'starting') {
      throw new Error('Stop the current session before changing the microphone.');
    }
    if (this.state.micDeviceId === deviceId) return;
    this.update({ micDeviceId: deviceId });
    this.invalidateEngine();
  }

  private invalidateEngine(): void {
    this.engine = null;
    if (this.engineUnsubscribe) {
      this.engineUnsubscribe();
      this.engineUnsubscribe = null;
    }
  }

  async startSession(): Promise<void> {
    if (this.state.status === 'active' || this.state.status === 'starting') return;
    sessionCounter += 1;
    this.currentSessionStartedAt = Date.now();
    this.update({ entries: [], errorMessage: null });
    if (!this.engine) this.engine = this.buildEngine();
    if (this.engineUnsubscribe) this.engineUnsubscribe();
    this.engineUnsubscribe = this.engine.on((ev) => this.handleEngineEvent(ev));
    try {
      await this.engine.start();
    } catch (err) {
      this.update({
        status: 'idle',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async stopSession(): Promise<void> {
    if (!this.engine) return;
    await this.engine.stop();
    if (this.state.entries.length > 0) {
      this.archiveCurrentSession();
    }
  }

  clearHistory(): void {
    this.update({ history: [] });
  }

  private archiveCurrentSession(): void {
    const startedAt = this.currentSessionStartedAt;
    const endedAt = Date.now();
    const past: PastSession = {
      id: `session-${sessionCounter}`,
      startedAt,
      endedAt,
      sourceLang: this.state.sourceLang === 'auto' ? 'auto' : this.state.sourceLang,
      targetLang: this.state.targetLang,
      mode: this.state.mode,
      entryCount: this.state.entries.length,
      preview: this.state.entries[0]?.text.slice(0, 80) ?? '',
    };
    this.update({ history: [past, ...this.state.history].slice(0, 50) });
  }

  private buildEngine(): EngineRouter {
    const capture =
      this.state.inputSource === 'tab'
        ? createTabAudioCapture()
        : createAudioCapture({
            deviceId: this.state.micDeviceId || undefined,
          });
    const opts: EngineFactoryOptions = {
      capture,
      playback: createAudioPlayback(),
      sourceLang: this.state.sourceLang,
      targetLang: this.state.targetLang,
      voice: this.state.voice,
      speakOutput: this.state.speakOutput,
      sttEngine: this.state.sttEngine,
      translationEngine: this.state.translationEngine,
      ttsEngine: this.state.ttsEngine,
    };
    return createEngineRouter(opts);
  }

  private handleEngineEvent(event: EngineEvent): void {
    if (event.type === 'status') {
      this.update({ status: event.status });
      return;
    }
    if (event.type === 'error') {
      this.update({ errorMessage: event.error.message });
      return;
    }
    if (event.type === 'partial-transcript') {
      this.upsertEntryByText(event.sessionId, event.text, event.detectedLang, 'partial');
      return;
    }
    if (event.type === 'final-transcript') {
      this.upsertEntryByText(event.sessionId, event.text, event.detectedLang, 'final');
      // Each final means the speaker has finished a turn — flip to the other
      // speaker for the next utterance in conversation mode.
      if (this.state.mode === 'conversation') this.toggleSpeaker();
      return;
    }
    if (event.type === 'translation-final') {
      this.attachTranslationToLastEntry(event.sessionId, event.result.text);
      return;
    }
  }

  private upsertEntryByText(
    sessionId: string,
    text: string,
    detectedLang: string | undefined,
    status: TranscriptEntry['status'],
  ): void {
    const entries = this.state.entries.slice();
    const last = entries[entries.length - 1];
    if (last && last.status === 'partial' && last.id.startsWith(sessionId)) {
      entries[entries.length - 1] = { ...last, text, detectedLang, status };
    } else {
      entryCounter += 1;
      const speakerId = this.state.mode === 'conversation' ? this.currentSpeaker : SPEAKER_A;
      entries.push({
        id: `${sessionId}-${entryCounter}`,
        speakerId,
        text,
        translation: '',
        detectedLang,
        status,
        startedAtMs: Date.now(),
      });
    }
    this.update({ entries });
  }

  private attachTranslationToLastEntry(sessionId: string, translation: string): void {
    const entries = this.state.entries.slice();
    // Find the most recent final entry for this session id that lacks a translation.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.id.startsWith(sessionId) && e.status === 'final' && e.translation.length === 0) {
        entries[i] = { ...e, translation, status: 'translated' };
        this.update({ entries });
        return;
      }
    }
    // No matching final found — likely the partial -> final upsert raced. Fall
    // back to the most recent entry.
    if (entries.length > 0) {
      const last = entries[entries.length - 1]!;
      entries[entries.length - 1] = { ...last, translation, status: 'translated' };
      this.update({ entries });
    }
  }

  private update(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}

// Module-level singleton — there is exactly one active translation session
// across the app.
export const sessionStore = new SessionStore();
