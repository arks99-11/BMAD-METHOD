/**
 * Story 3.5 — Translation pre-emption.
 *
 * The orchestrator sits between the STT pipeline and the active
 * `MtProvider`. STT emits a stream of partial → final transcripts; this
 * orchestrator decides which of those to translate and how to manage
 * cancellation when newer partials make older translations obsolete.
 *
 * Pre-emption rules (PRD §3.4 acceptance criteria):
 *
 *  1. Only one in-flight translation at a time per orchestrator. When a
 *     newer partial transcript arrives while a translation is still
 *     running, the in-flight translation is cancelled (AbortController)
 *     and a new one starts.
 *
 *  2. Final transcripts always commit. They are never pre-empted by
 *     subsequent partials — the orchestrator emits the final
 *     translation and resets.
 *
 *  3. Partials are debounced. If two partials arrive within
 *     `partialDebounceMs` (default 80 ms), the orchestrator coalesces
 *     them and only translates the newer one. This keeps cost down
 *     and avoids GPU thrashing on the model.
 *
 *  4. Empty / whitespace-only transcripts are silently dropped.
 *
 *  5. The orchestrator is provider-agnostic — pass a `DeeplProvider`,
 *     `GoogleMtProvider`, or `OpenAiMtProvider`; pre-emption works the
 *     same way.
 *
 * Events emitted on the listener:
 *   - `chunk`   — incremental text from the active translation. Only
 *                 the streaming providers (`OpenAiMtProvider`) emit
 *                 multiple chunks; single-shot providers emit one.
 *   - `partial` — a complete partial translation (resolves once the
 *                 underlying stream's `final` event fires).
 *   - `final`   — a complete final translation.
 *   - `cancelled` — the previous in-flight translation was pre-empted.
 *   - `error`   — a non-cancellation error from the provider.
 */

import { MtError, type MtProvider, type MtRequest, type MtResult } from './mt-types';

export type OrchestratorEvent =
  | { type: 'chunk'; text: string; isFinal: boolean }
  | { type: 'partial'; result: MtResult }
  | { type: 'final'; result: MtResult }
  | { type: 'cancelled' }
  | { type: 'error'; error: MtError };

export type OrchestratorListener = (event: OrchestratorEvent) => void;

export interface TranslationOrchestratorOptions {
  provider: MtProvider;
  /** Default 80 ms. */
  partialDebounceMs?: number;
}

interface PendingRequest {
  controller: AbortController;
  isFinal: boolean;
}

export class TranslationOrchestrator {
  private readonly provider: MtProvider;
  private readonly partialDebounceMs: number;
  private readonly listeners = new Set<OrchestratorListener>();

  private pending: PendingRequest | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debouncedReq: MtRequest | null = null;

  constructor(opts: TranslationOrchestratorOptions) {
    this.provider = opts.provider;
    this.partialDebounceMs = opts.partialDebounceMs ?? 80;
  }

  on(listener: OrchestratorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Submit a partial transcript for translation. May be cancelled by a
   * subsequent partial or final. Coalesced within
   * `partialDebounceMs`.
   */
  submitPartial(req: MtRequest): void {
    if (req.text.trim().length === 0) return;
    this.debouncedReq = req;
    if (this.debounceTimer !== null) {
      return; // Pending debounce will pick up the latest req.
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const queued = this.debouncedReq;
      this.debouncedReq = null;
      if (queued !== null) {
        this.dispatchPartial(queued);
      }
    }, this.partialDebounceMs);
  }

  /**
   * Submit a final transcript for translation. Cancels any in-flight
   * partial, flushes any pending debounce, and commits the final
   * translation.
   */
  submitFinal(req: MtRequest): void {
    if (req.text.trim().length === 0) {
      // Even an empty final must reset state so the next utterance
      // starts fresh.
      this.cancelPending('drop');
      this.clearDebounce();
      return;
    }
    this.clearDebounce();
    this.cancelPending('preempt');
    this.dispatch(req, /* isFinal */ true);
  }

  /**
   * Force-cancel any in-flight translation and clear pending debounce.
   * Used on session end or language change.
   */
  reset(): void {
    this.clearDebounce();
    this.cancelPending('drop');
  }

  private dispatchPartial(req: MtRequest): void {
    this.cancelPending('preempt');
    this.dispatch(req, /* isFinal */ false);
  }

  private dispatch(req: MtRequest, isFinal: boolean): void {
    const controller = new AbortController();
    const reqWithSignal: MtRequest = { ...req, signal: controller.signal };
    this.pending = { controller, isFinal };

    const stream = this.provider.translateStream(reqWithSignal);
    // Events flow through `on()`; suppress the `done` promise's
    // unhandled rejection on cancel/error.
    stream.done.catch(() => undefined);
    stream.on((ev) => {
      if (ev.type === 'chunk') {
        this.emit({ type: 'chunk', text: ev.text, isFinal });
      } else if (ev.type === 'final') {
        if (this.pending?.controller === controller) {
          this.pending = null;
        }
        this.emit({
          type: isFinal ? 'final' : 'partial',
          result: ev.result,
        });
      } else if (ev.type === 'error') {
        if (ev.error.code === 'cancelled') {
          // Pre-emption already emitted `cancelled`; suppress.
          return;
        }
        if (this.pending?.controller === controller) {
          this.pending = null;
        }
        this.emit({ type: 'error', error: ev.error });
      }
    });
  }

  private cancelPending(mode: 'preempt' | 'drop'): void {
    if (this.pending === null) return;
    this.pending.controller.abort();
    this.pending = null;
    if (mode === 'preempt') {
      this.emit({ type: 'cancelled' });
    }
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.debouncedReq = null;
  }

  private emit(ev: OrchestratorEvent): void {
    for (const l of this.listeners) {
      l(ev);
    }
  }
}
