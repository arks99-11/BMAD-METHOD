/**
 * Story 5.3 — Turn log view-model.
 *
 * Accumulates the running list of `TurnPair`s for a session. The UI
 * subscribes via the session controller's event stream; this class is
 * the data-only side that the controller updates as STT and MT events
 * flow through.
 *
 * Turn lifecycle:
 *
 *   1. `openTurn(sourceLang, targetLang)` — create a new `TurnPair`
 *      with empty source and target. The id is generated here.
 *   2. `updateSourcePartial(id, text)` — STT partial. Source grows.
 *   3. `commitSourceFinal(id, text)` — STT final. Source flips to
 *      isFinal=true. The translation can now be assumed to use this
 *      exact source text (no further pre-emptions on this turn).
 *   4. `updateTargetPartial(id, text)` — MT partial / first chunk.
 *   5. `commitTargetFinal(id, text)` — MT final. Both sides isFinal;
 *      `completedAt` is stamped.
 *
 * Pre-emption: if a newer STT partial arrives before the current turn
 * has committed its target, the controller calls `replaceOpenSource`
 * which extends the open turn's source rather than opening a new one.
 * This way a single turn corresponds to a single utterance even if it
 * went through several partial→final cycles.
 */

import type { LangCode } from '../audio/audio-session-types';
import type { TurnPair, TurnSide } from './session-types';

let nextId = 1;

export function makeTurnId(): string {
  const id = `turn-${nextId.toString(36)}`;
  nextId += 1;
  return id;
}

/** Reset the id sequence (tests only). */
export function resetTurnIdSequence(): void {
  nextId = 1;
}

export class TurnLog {
  private readonly turns: TurnPair[] = [];
  private readonly index = new Map<string, TurnPair>();

  /** Open a new turn and return it. */
  openTurn(sourceLang: LangCode, targetLang: LangCode, startedAt: number): TurnPair {
    const turn: TurnPair = {
      id: makeTurnId(),
      source: emptySide(sourceLang),
      target: emptySide(targetLang),
      startedAt,
    };
    this.turns.push(turn);
    this.index.set(turn.id, turn);
    return turn;
  }

  /** Replace the current open turn's source text (pre-emption). */
  updateSourcePartial(id: string, text: string): TurnPair | undefined {
    const turn = this.index.get(id);
    if (turn === undefined) return undefined;
    turn.source = { ...turn.source, text, isFinal: false };
    return turn;
  }

  /** Commit a final source. */
  commitSourceFinal(id: string, text: string): TurnPair | undefined {
    const turn = this.index.get(id);
    if (turn === undefined) return undefined;
    turn.source = { ...turn.source, text, isFinal: true };
    return turn;
  }

  /** Replace the open turn's target side (used during streaming MT). */
  updateTargetPartial(id: string, text: string): TurnPair | undefined {
    const turn = this.index.get(id);
    if (turn === undefined) return undefined;
    turn.target = { ...turn.target, text, isFinal: false };
    return turn;
  }

  /** Commit a final target; stamps `completedAt`. */
  commitTargetFinal(id: string, text: string, completedAt: number): TurnPair | undefined {
    const turn = this.index.get(id);
    if (turn === undefined) return undefined;
    turn.target = { ...turn.target, text, isFinal: true };
    turn.completedAt = completedAt;
    return turn;
  }

  /** Update the source-side language (used after a language-detected event). */
  updateSourceLang(id: string, lang: LangCode): TurnPair | undefined {
    const turn = this.index.get(id);
    if (turn === undefined) return undefined;
    turn.source = { ...turn.source, lang };
    return turn;
  }

  /** Get a turn by id. */
  get(id: string): TurnPair | undefined {
    return this.index.get(id);
  }

  /** All turns, in insertion order. */
  list(): TurnPair[] {
    return [...this.turns];
  }

  /** The most recent open (not-yet-completed) turn, or undefined. */
  openTurnOrUndefined(): TurnPair | undefined {
    for (let i = this.turns.length - 1; i >= 0; i -= 1) {
      const t = this.turns[i]!;
      if (t.completedAt === undefined) return t;
    }
    return undefined;
  }

  /** Drop all turns. Used on session restart. */
  clear(): void {
    this.turns.length = 0;
    this.index.clear();
  }

  /** Count of turns. */
  size(): number {
    return this.turns.length;
  }
}

function emptySide(lang: LangCode): TurnSide {
  return { text: '', lang, isFinal: false };
}
