/**
 * Story 10.5 — Onboarding state machine.
 *
 * The onboarding flow asks the user for: microphone permission,
 * default language pair, voice preference, and (optionally)
 * sign-in. The app shows the next pending step on launch until the
 * checklist is complete. State persists to `LocalStore.settings`
 * so a relaunch resumes where the user left off.
 */

import type { LocalStore } from '../store/store-types';

export type OnboardingStepId =
  | 'welcome'
  | 'mic-permission'
  | 'language-pair'
  | 'voice-pick'
  | 'sign-in'
  | 'done';

export interface OnboardingState {
  current: OnboardingStepId;
  completed: readonly OnboardingStepId[];
}

const STORAGE_KEY = 'app.onboarding';

const DEFAULT_FLOW: OnboardingStepId[] = [
  'welcome',
  'mic-permission',
  'language-pair',
  'voice-pick',
  'sign-in',
  'done',
];

export class OnboardingManager {
  private readonly store: LocalStore;
  private internalState: OnboardingState = { current: 'welcome', completed: [] };
  private readonly listeners = new Set<(s: OnboardingState) => void>();
  /**
   * Optional override for the step sequence. Defaults to
   * `DEFAULT_FLOW` (welcome -> mic -> langs -> voice -> sign-in -> done).
   */
  private readonly flow: OnboardingStepId[];

  constructor(store: LocalStore, flow: OnboardingStepId[] = DEFAULT_FLOW) {
    this.store = store;
    this.flow = [...flow];
  }

  on(listener: (s: OnboardingState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  state(): OnboardingState {
    return {
      current: this.internalState.current,
      completed: [...this.internalState.completed],
    };
  }

  async load(): Promise<void> {
    const raw = await this.store.getSetting(STORAGE_KEY);
    if (raw === undefined) return;
    try {
      const parsed = JSON.parse(raw) as Partial<OnboardingState>;
      const completed = Array.isArray(parsed.completed)
        ? parsed.completed.filter(isStepId)
        : [];
      const current =
        typeof parsed.current === 'string' && isStepId(parsed.current)
          ? parsed.current
          : this.firstPending(completed);
      this.internalState = { current, completed };
    } catch {
      // Corrupt JSON — fall back to defaults.
    }
    this.emit();
  }

  /**
   * Mark a step as completed and advance. Idempotent: re-completing
   * a step is a no-op.
   */
  async complete(step: OnboardingStepId): Promise<void> {
    if (this.internalState.completed.includes(step)) return;
    const completed = [...this.internalState.completed, step];
    const current = this.firstPending(completed);
    this.internalState = { current, completed };
    await this.persist();
    this.emit();
  }

  /** Skip a step without marking it completed (allowed for sign-in). */
  async skip(step: OnboardingStepId): Promise<void> {
    if (step !== 'sign-in') {
      throw new Error(`OnboardingManager: cannot skip required step '${step}'.`);
    }
    await this.complete(step);
  }

  /** Drop progress; the next launch starts from welcome. */
  async reset(): Promise<void> {
    this.internalState = { current: this.flow[0]!, completed: [] };
    await this.persist();
    this.emit();
  }

  isDone(): boolean {
    return this.internalState.current === 'done';
  }

  private firstPending(completed: readonly OnboardingStepId[]): OnboardingStepId {
    for (const step of this.flow) {
      if (!completed.includes(step)) return step;
    }
    return 'done';
  }

  private async persist(): Promise<void> {
    await this.store.setSetting(STORAGE_KEY, JSON.stringify(this.internalState));
  }

  private emit(): void {
    const snap = this.state();
    for (const l of this.listeners) l(snap);
  }
}

function isStepId(s: unknown): s is OnboardingStepId {
  return (
    s === 'welcome' ||
    s === 'mic-permission' ||
    s === 'language-pair' ||
    s === 'voice-pick' ||
    s === 'sign-in' ||
    s === 'done'
  );
}
