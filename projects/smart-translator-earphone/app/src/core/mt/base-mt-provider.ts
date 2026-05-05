/**
 * Base helpers shared by all MT adapters.
 *
 * The most useful is `wrapAsStream`: lifts a single-shot
 * `translate(req): Promise<MtResult>` into the streaming
 * `MtStream` shape so callers don't have to branch on whether the
 * underlying engine supports streaming. The returned stream emits
 * exactly one `chunk` event with the full translation, then `final`.
 */

import { MtError } from './mt-types';
import type {
  MtEngine,
  MtResult,
  MtStream,
  MtStreamEvent,
  MtStreamListener,
} from './mt-types';

export function wrapAsStream(
  engine: MtEngine,
  promise: Promise<MtResult>,
): MtStream {
  const listeners = new Set<MtStreamListener>();
  const queued: MtStreamEvent[] = [];
  let terminal: MtStreamEvent | null = null;

  const dispatch = (ev: MtStreamEvent): void => {
    if (terminal !== null) return;
    if (ev.type === 'final' || ev.type === 'error') {
      terminal = ev;
    }
    if (listeners.size === 0) {
      queued.push(ev);
      return;
    }
    for (const l of listeners) {
      l(ev);
    }
  };

  const done = promise
    .then((result): MtResult => {
      dispatch({ type: 'chunk', text: result.text });
      dispatch({ type: 'final', result });
      return result;
    })
    .catch((err: unknown): never => {
      const error = err as MtError;
      dispatch({ type: 'error', error });
      throw error;
    });

  return {
    engine,
    on(listener: MtStreamListener): () => void {
      // Replay any queued events to the new listener so registration
      // ordering doesn't lose data.
      if (queued.length > 0 && listeners.size === 0) {
        const replay = [...queued];
        queued.length = 0;
        for (const ev of replay) {
          listener(ev);
        }
      } else if (terminal !== null) {
        listener(terminal);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    done,
  };
}

/**
 * Common AbortSignal handling: returns an abort-aware Promise that
 * rejects with an `MtError` of code `cancelled` when the signal fires.
 *
 * Usage:
 *   const aborted = abortablePromise(signal, engine);
 *   const result = await Promise.race([fetchTranslation(), aborted]);
 */
export function abortablePromise(
  signal: AbortSignal | undefined,
  engine: MtEngine,
): Promise<never> {
  if (signal === undefined) {
    return new Promise<never>(() => undefined); // never resolves
  }
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(makeCancelled(engine));
      return;
    }
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(makeCancelled(engine));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function makeCancelled(engine: MtEngine): MtError {
  return new MtError('cancelled', engine, 'Translation cancelled by caller.');
}
