/**
 * Shared helpers for TTS adapters: streaming wrapper, abort plumbing,
 * and chunk-collector utility.
 */

import { TtsError } from './tts-types';
import type {
  TtsEngine,
  TtsResult,
  TtsStream,
  TtsStreamEvent,
  TtsStreamListener,
} from './tts-types';

export function wrapAsTtsStream(
  engine: TtsEngine,
  promise: Promise<TtsResult>,
): TtsStream {
  const listeners = new Set<TtsStreamListener>();
  const queued: TtsStreamEvent[] = [];
  let terminal: TtsStreamEvent | null = null;

  const dispatch = (ev: TtsStreamEvent): void => {
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
    .then((result): TtsResult => {
      dispatch({ type: 'chunk', audio: result.audio, format: result.format });
      dispatch({ type: 'final', result });
      return result;
    })
    .catch((err: unknown): never => {
      const error =
        err instanceof TtsError
          ? err
          : new TtsError('unknown', engine, err instanceof Error ? err.message : String(err));
      dispatch({ type: 'error', error });
      throw error;
    });

  return {
    engine,
    on(listener: TtsStreamListener): () => void {
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

export function abortablePromise(
  signal: AbortSignal | undefined,
  engine: TtsEngine,
): Promise<never> {
  if (signal === undefined) {
    return new Promise<never>(() => undefined);
  }
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new TtsError('cancelled', engine, 'Synthesis cancelled by caller.'));
      return;
    }
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(new TtsError('cancelled', engine, 'Synthesis cancelled by caller.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Concatenate a list of Uint8Arrays into a single buffer. Lifted into
 * a helper because adapters use it in two places (collecting streamed
 * chunks and assembling the final result).
 */
export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Read a whole `ReadableStream<Uint8Array>` body into a single array,
 * yielding chunks along the way via the provided callback.
 */
export async function readStreamWithCallback(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      if (signal?.aborted === true) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw new Error('aborted');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        chunks.push(value);
        onChunk(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return concatChunks(chunks);
}
