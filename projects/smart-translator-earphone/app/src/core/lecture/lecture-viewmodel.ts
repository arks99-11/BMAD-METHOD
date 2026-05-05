/**
 * Story 6.1, 6.2, 6.3 — Lecture Mode view-model.
 *
 * Lecture Mode shares its session pipeline with Conversation Mode
 * (Epic 5) but renders two synchronized scrolling columns instead of
 * a chat thread. This view-model is the framework-agnostic state that
 * the React Native lecture screen will subscribe to.
 *
 * Responsibilities:
 *
 *  1. Track whether the user is tailing live or scrolled back (Story
 *     6.3). When tailing live, every new turn updates the anchor; when
 *     scrolled back, new turns append silently and the UI shows a
 *     `Live` pill that returns the user to the bottom on tap.
 *  2. Track the active anchor turn id (Story 6.2). Tapping a line in
 *     either column sets the anchor; the other column scrolls to the
 *     paired turn (which is the same id since both columns share the
 *     `TurnPair` entry).
 *  3. Audio playback continues regardless of scroll position (Story
 *     6.3) — this is enforced by NOT calling pause/cancel on the
 *     playback orchestrator from this view-model. Keeping the rule
 *     here as a doc-only guarantee plus a unit test.
 */

import type { TurnPair } from '../session/session-types';

export interface LectureViewModelState {
  /** Latest turn list received from the session controller. */
  turns: TurnPair[];
  /** True when the UI should auto-scroll to the latest turn. */
  isLive: boolean;
  /**
   * The id of the turn the user has anchored on (after tapping a
   * line). Undefined when the user is at the bottom in live mode.
   */
  anchorTurnId?: string;
}

export type LectureListener = (state: LectureViewModelState) => void;

export class LectureViewModel {
  private turns: TurnPair[] = [];
  private live = true;
  private anchor: string | undefined = undefined;
  private readonly listeners = new Set<LectureListener>();

  on(listener: LectureListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Replace the in-memory turn list (controller pushes the latest). */
  setTurns(turns: TurnPair[]): void {
    this.turns = [...turns];
    if (this.live) {
      this.anchor = undefined;
    }
    this.emit();
  }

  /**
   * The user tapped a line in either column. The view-model anchors
   * on the turn id and exits live mode (Story 6.3).
   */
  anchorOn(turnId: string): void {
    if (this.turns.find((t) => t.id === turnId) === undefined) return;
    this.anchor = turnId;
    this.live = false;
    this.emit();
  }

  /** User tapped the `Live` pill. Returns to live tailing. */
  goLive(): void {
    this.live = true;
    this.anchor = undefined;
    this.emit();
  }

  state(): LectureViewModelState {
    const s: LectureViewModelState = {
      turns: [...this.turns],
      isLive: this.live,
    };
    if (this.anchor !== undefined) s.anchorTurnId = this.anchor;
    return s;
  }

  private emit(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }
}
