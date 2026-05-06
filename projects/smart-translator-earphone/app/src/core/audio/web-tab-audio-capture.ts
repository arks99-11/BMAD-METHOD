/**
 * Tab / window / system audio capture provider for the web platform.
 *
 * Wraps `navigator.mediaDevices.getDisplayMedia({ audio: true })` — the
 * same API the browser uses for screen-sharing. The user is prompted to
 * pick a tab/window/screen, and when sharing a tab they must explicitly
 * tick "Share tab audio" (Chrome / Edge / Brave) for an audio track to
 * be returned. Firefox and Safari support is partial: they may return a
 * stream with only video, in which case we throw a clear error so the
 * caller can fall back to mic capture.
 *
 * The audio processing pipeline (downsample to 16 kHz mono int16, slice
 * into FRAME_SAMPLES frames) is identical to {@link WebAudioCaptureProvider};
 * only the source of the MediaStream differs.
 *
 * Use case: translate audio from a YouTube/Netflix/conference tab without
 * routing the speaker output back through a microphone.
 *
 * Permissions: requires user to grant screen-share permission AND tick the
 * "Share tab audio" checkbox in the picker. Without the audio checkbox,
 * the returned stream has no audio track and the provider fails fast.
 */

import type {
  AudioCaptureProvider,
  CaptureState,
  ErrorListener,
  FrameListener,
  StateListener,
} from './audio-capture';
import { FRAME_SAMPLES, SAMPLE_RATE_HZ, type AudioFrame } from './audio-types';
import { concatFloat32, downsampleFloat32, floatToInt16 } from './web-audio-utils';

interface DisplayMediaGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  navigator?: {
    mediaDevices?: {
      getDisplayMedia?: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
    };
  };
}

const RESAMPLE_SAMPLE_RATE = SAMPLE_RATE_HZ; // 16000

export interface WebTabAudioCaptureOptions {
  /**
   * Whether to also request a video track. The browser **requires** at
   * least one of audio or video; Chrome additionally requires video to
   * be requested in order to enable the "Share tab audio" checkbox in
   * the picker. Defaults to true.
   */
  requestVideo?: boolean;
}

export class WebTabAudioCaptureProvider implements AudioCaptureProvider {
  private _state: CaptureState = 'idle';
  private readonly frameListeners = new Set<FrameListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly stateListeners = new Set<StateListener>();
  private mediaStream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private leftover = new Float32Array(0);
  private seq = 0;
  private startMs = 0;

  constructor(private readonly opts: WebTabAudioCaptureOptions = {}) {}

  get state(): CaptureState {
    return this._state;
  }

  async start(): Promise<void> {
    if (this._state === 'capturing' || this._state === 'starting') return;
    this.transition('starting');
    try {
      const g = globalThis as unknown as DisplayMediaGlobals;
      const Ctx = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctx) throw new Error('AudioContext is not available in this environment');
      const getDisplayMedia = g.navigator?.mediaDevices?.getDisplayMedia;
      if (!getDisplayMedia) {
        throw new Error(
          'navigator.mediaDevices.getDisplayMedia is not available — tab audio capture requires Chrome / Edge / Brave (or another Chromium-based browser).',
        );
      }
      const requestVideo = this.opts.requestVideo ?? true;
      this.context = new Ctx();
      this.mediaStream = await getDisplayMedia.call(g.navigator!.mediaDevices, {
        audio: true,
        video: requestVideo,
      } as DisplayMediaStreamOptions);

      const audioTracks = this.mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // User dismissed the audio checkbox in the picker, or browser doesn't
        // support tab audio. Tear down and fail fast.
        for (const t of this.mediaStream.getTracks()) t.stop();
        throw new Error(
          'No audio track in the shared stream. When sharing a tab, tick "Share tab audio" in the browser picker.',
        );
      }
      // We don't need the video track — drop it immediately to free the
      // screen-share indicator chip the browser shows.
      for (const t of this.mediaStream.getVideoTracks()) t.stop();

      this.source = this.context.createMediaStreamSource(this.mediaStream);
      const bufferSize = 4096;
      this.node = this.context.createScriptProcessor(bufferSize, 1, 1);
      this.node.onaudioprocess = (event: AudioProcessingEvent) => this.handleBuffer(event);
      this.source.connect(this.node);
      // IMPORTANT: do NOT connect to context.destination — that would loop
      // the captured tab audio back through the speakers, creating an
      // echo + feedback loop. Use a silent gain or unconnected processing
      // sink. Browsers happily run an unconnected ScriptProcessorNode.
      this.seq = 0;
      this.startMs = Date.now();
      this.transition('capturing');

      // Browser automatically stops the stream when the user clicks "Stop
      // sharing" in the screen-share chip; mirror that into our own stop().
      audioTracks[0]!.addEventListener('ended', () => {
        if (this._state === 'capturing' || this._state === 'starting') {
          void this.stop();
        }
      });
    } catch (err) {
      this.transition('errored');
      const error = err instanceof Error ? err : new Error(String(err));
      for (const l of this.errorListeners) l(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this._state === 'idle') return;
    this.transition('stopping');
    try {
      this.node?.disconnect();
      this.source?.disconnect();
      await this.context?.close();
    } catch {
      // ignore tear-down errors
    }
    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
    }
    this.node = null;
    this.source = null;
    this.context = null;
    this.mediaStream = null;
    this.leftover = new Float32Array(0);
    this.transition('idle');
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private handleBuffer(event: AudioProcessingEvent): void {
    if (this._state !== 'capturing' || !this.context) return;
    const inputBuffer = event.inputBuffer.getChannelData(0);
    const inputRate = this.context.sampleRate;
    const downSampled = downsampleFloat32(inputBuffer, inputRate, RESAMPLE_SAMPLE_RATE);
    const merged = concatFloat32(this.leftover, downSampled);
    const fullFrames = Math.floor(merged.length / FRAME_SAMPLES);
    for (let i = 0; i < fullFrames; i++) {
      const start = i * FRAME_SAMPLES;
      const slice = merged.subarray(start, start + FRAME_SAMPLES);
      const samples = floatToInt16(slice);
      const frame: AudioFrame = {
        samples,
        seq: this.seq++,
        timestampMs:
          this.startMs + Math.round((this.seq * 1000 * FRAME_SAMPLES) / RESAMPLE_SAMPLE_RATE),
      };
      for (const l of this.frameListeners) l(frame);
    }
    this.leftover = merged.subarray(fullFrames * FRAME_SAMPLES);
  }

  private transition(next: CaptureState): void {
    this._state = next;
    for (const l of this.stateListeners) l(next);
  }
}

/**
 * Detects whether the current browser supports tab audio capture. A truthy
 * answer means `getDisplayMedia` is available; it does NOT guarantee that
 * the user will tick the "Share audio" checkbox in the picker.
 */
export function isTabAudioCaptureSupported(): boolean {
  const g = globalThis as unknown as DisplayMediaGlobals;
  return Boolean(g.navigator?.mediaDevices?.getDisplayMedia);
}
