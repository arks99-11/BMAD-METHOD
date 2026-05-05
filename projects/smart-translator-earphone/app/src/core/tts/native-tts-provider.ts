/**
 * Story 4.3a — Native TTS provider (JS surface).
 *
 * The actual native runtime (iOS AVSpeechSynthesizer, Android
 * TextToSpeech) lives behind a `NativeTtsBridge` interface. The JS
 * shell calls the bridge via React Native's NativeModules; tests
 * inject a fake bridge. The native modules themselves land in the
 * native sprint (Story 4.3b) — this PR fixes the contract so the
 * router and UI can already plumb through `'native'` as an engine.
 *
 * Two important design choices:
 *
 *  1. The native engines synthesise to the speaker directly — we
 *     don't get raw audio bytes. So `synthesize` returns a `TtsResult`
 *     with an empty audio buffer and the playback orchestrator
 *     branches on `engine === 'native'` to skip the sink-feed step.
 *     The bridge does its own playback.
 *
 *  2. Cancellation goes through `bridge.stop(handle)`. The provider
 *     owns the handle lifecycle — caller never sees it.
 */

import { TtsError, type TtsProvider, type TtsRequest, type TtsResult, type TtsStream } from './tts-types';

export interface NativeTtsBridge {
  /**
   * Start synthesis. The bridge resolves when audio finishes playing
   * naturally; rejects on error or cancellation.
   *
   * Returns a handle that can be passed to `stop()` to cancel.
   */
  speak(req: NativeTtsBridgeRequest): NativeTtsBridgeHandle;
  /**
   * Returns the list of installed voices. The voice catalog (Story
   * 4.4) consumes this to populate the picker.
   */
  listVoices(): Promise<NativeTtsBridgeVoice[]>;
}

export interface NativeTtsBridgeRequest {
  text: string;
  voice: string;
  language: string;
  rate?: number;
  pitch?: number;
}

export interface NativeTtsBridgeVoice {
  id: string;
  name: string;
  language: string;
  /** ISO-639-1 region; iOS exposes 'en-US', 'en-GB', etc. */
  quality?: 'default' | 'enhanced' | 'premium';
}

export interface NativeTtsBridgeHandle {
  /** Promise that resolves on natural completion, rejects on cancel/error. */
  done: Promise<void>;
  /** Best-effort cancel. Idempotent. */
  cancel(): void;
}

export class NativeTtsProvider implements TtsProvider {
  readonly engine = 'native' as const;

  constructor(private readonly bridge: NativeTtsBridge) {}

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    return this.synthesizeStream(req).done;
  }

  synthesizeStream(req: TtsRequest): TtsStream {
    const start = Date.now();
    const listeners = new Set<(ev: import('./tts-types').TtsStreamEvent) => void>();
    let terminal: 'final' | 'error' | null = null;

    const emit = (ev: import('./tts-types').TtsStreamEvent): void => {
      if (terminal !== null) return;
      if (ev.type === 'final' || ev.type === 'error') terminal = ev.type;
      for (const l of listeners) l(ev);
    };

    const bridgeReq: NativeTtsBridgeRequest = {
      text: req.text,
      voice: req.voice,
      language: req.language,
      ...(req.rate !== undefined ? { rate: req.rate } : {}),
      ...(req.pitch !== undefined ? { pitch: req.pitch } : {}),
    };

    const handle = this.bridge.speak(bridgeReq);
    let cancelled = false;
    if (req.signal !== undefined) {
      if (req.signal.aborted) {
        cancelled = true;
        handle.cancel();
      } else {
        req.signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            handle.cancel();
          },
          { once: true },
        );
      }
    }

    const done: Promise<TtsResult> = handle.done
      .then((): TtsResult => {
        const result: TtsResult = {
          audio: new Uint8Array(0),
          format: req.format ?? 'pcm-s16le-24k',
          engine: 'native',
          voice: req.voice,
          durationMs: Date.now() - start,
        };
        emit({ type: 'final', result });
        return result;
      })
      .catch((err: unknown): never => {
        const error = mapNativeError(err, cancelled);
        emit({ type: 'error', error });
        throw error;
      });
    done.catch(() => undefined);

    return {
      engine: 'native',
      on(listener): () => void {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      done,
    };
  }

  /**
   * List the voices the platform exposes. Used by the voice catalog
   * (Story 4.4) to populate the picker.
   */
  async listVoices(): Promise<NativeTtsBridgeVoice[]> {
    return this.bridge.listVoices();
  }
}

function mapNativeError(err: unknown, cancelled: boolean): TtsError {
  if (cancelled) return new TtsError('cancelled', 'native', 'Native TTS cancelled.');
  if (err instanceof TtsError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/cancel/i.test(msg) || /abort/i.test(msg)) {
    return new TtsError('cancelled', 'native', msg);
  }
  if (/voice/i.test(msg)) {
    return new TtsError('unsupported-voice', 'native', msg);
  }
  if (/language/i.test(msg)) {
    return new TtsError('unsupported-language', 'native', msg);
  }
  return new TtsError('engine', 'native', msg);
}
