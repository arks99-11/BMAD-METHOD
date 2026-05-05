/**
 * Shared types for Epic 5 (Conversation Mode UI controllers).
 *
 * These types describe the contract between the session controller
 * (which orchestrates audio + STT + MT + TTS) and the UI layer (the
 * React Native screens that will consume it). The controller is
 * framework-agnostic so it can be unit-tested without RN running.
 */

import type { LangCode } from '../audio/audio-session-types';
import type { CorridorPolicy, RouteDecision } from '../engine-router/types';

/**
 * The session lifecycle states surfaced to the UI.
 *
 *  - `idle`       : nothing running; user has not pressed mic.
 *  - `listening`  : audio capture active; STT session open. The UI shows
 *                   the mic-level meter and current transcript.
 *  - `translating`: an STT final has fired and we're waiting for the
 *                   translation to come back. The mic stays open for
 *                   the next utterance — this state is per-turn, not
 *                   global. The UI keeps showing the meter.
 *  - `speaking`   : TTS playback is in progress. Mic stays open.
 *  - `error`      : an unrecoverable error fired. The UI surfaces a
 *                   banner and gives the user a retry button.
 */
export type SessionState = 'idle' | 'listening' | 'translating' | 'speaking' | 'error';

/**
 * A single turn — one utterance and its translation. The id is stable
 * for the life of the turn so the UI can address it for animations.
 *
 * Both source and target start as partial (text grows as STT/MT
 * stream); they're promoted to final when the upstream commits.
 */
export interface TurnPair {
  id: string;
  source: TurnSide;
  target: TurnSide;
  /** ms since session start. */
  startedAt: number;
  /** Set when the target side reaches `isFinal`. */
  completedAt?: number;
}

export interface TurnSide {
  text: string;
  lang: LangCode;
  isFinal: boolean;
}

/**
 * Engine attribution surfaced by the transparency sheet (Story 5.4).
 * The session controller updates this whenever the engine router's
 * decision changes (e.g. user toggles cloud-off mid-session).
 */
export interface EngineTransparency {
  stt: string;
  mt: string;
  tts: string;
  /** Reason the router chose this corridor (debug). */
  reason: RouteDecision['reason'];
  /** Matched corridor key from the policy table, or synthetic marker. */
  corridor: string;
  /** Rolling latency stats for the last `n` turns, in ms. */
  latency: {
    sttMs?: number;
    mtMs?: number;
    ttsMs?: number;
  };
}

export type SessionEvent =
  | { type: 'state'; state: SessionState }
  | { type: 'turn-appended'; turn: TurnPair }
  | { type: 'turn-updated'; turn: TurnPair }
  | { type: 'language-detected'; lang: LangCode; confidence: number }
  | { type: 'transparency'; data: EngineTransparency }
  | { type: 'error'; message: string };

export type SessionListener = (event: SessionEvent) => void;

/**
 * Session start parameters.
 *
 *  - `sourceLang`  : initial source language. May be revised by a
 *                    `language-detected` event from the STT layer.
 *  - `targetLang`  : target language; selected by the user up-front.
 *  - `voiceId`     : id from the voice catalog (Story 4.4); resolves
 *                    to a `(engine, providerVoiceId)` at the TTS layer.
 *  - `tier`        : 'free' or 'pro'. Drives the engine router.
 *  - `cloudOff`    : the user's privacy toggle.
 *  - `contextAware`: 'pro' opt-in for rolling-context MT (Story 3.3).
 */
export interface SessionStartOptions {
  sourceLang: LangCode;
  targetLang: LangCode;
  voiceId: string;
  tier: 'free' | 'pro';
  cloudOff?: boolean;
  contextAware?: boolean;
  online?: boolean;
}

export interface SessionSnapshot {
  state: SessionState;
  turns: TurnPair[];
  transparency?: EngineTransparency;
  /** Last decision the router returned. */
  lastDecision?: { policy: CorridorPolicy; reason: RouteDecision['reason']; corridor: string };
}
