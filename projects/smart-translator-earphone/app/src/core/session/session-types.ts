/**
 * Shared session data types — minimal data-only subset.
 *
 * The conversation orchestrator that owns the session state machine
 * lives in PR #18's `state/SessionStore.ts`. The types in this file
 * are the subset shared with the lecture view-model (PR #11),
 * group view-model (PR #14), and any other consumer that needs to
 * speak the same `TurnPair` shape without taking a dependency on
 * the orchestrator runtime.
 */

import type { LangCode } from '../audio/audio-session-types';

export interface TurnSide {
  /** Text accumulated so far for this side. */
  text: string;
  /** Language code for this side. */
  lang: LangCode;
  /** True once the upstream stage commits this side. */
  isFinal: boolean;
}

/**
 * A single turn — one utterance and its translation. The `id` is
 * stable for the life of the turn so consumers can address it for
 * animations, anchor scrolling, and group fan-out.
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
