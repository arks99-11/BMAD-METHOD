/**
 * Web Audio capture provider — implements `AudioCaptureProvider` for the
 * browser using `navigator.mediaDevices.getUserMedia` + an `AudioContext`
 * with an `AudioWorkletNode` (or fallback `ScriptProcessorNode`).
 *
 * The provider:
 *   1. Opens the mic at whatever sample rate the browser provides (typically
 *      44.1 kHz or 48 kHz).
 *   2. Down-samples to 16 kHz mono int16 (the project's pipeline-wide format).
 *   3. Slices the down-sampled stream into FRAME_SAMPLES (320) frames and
 *      emits them.
 *
 * No external libraries are used — only Web Audio APIs available in every
 * evergreen browser.
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

interface WebAudioGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  navigator?: { mediaDevices?: MediaDevices };
}

const RESAMPLE_SAMPLE_RATE = SAMPLE_RATE_HZ; // 16000

export interface WebAudioCaptureOptions {
  /**
   * The `MediaDeviceInfo.deviceId` to capture from. When omitted the
   * browser uses its default audio input device. Note that browsers
   * only return non-empty deviceIds AFTER the user has granted mic
   * permission at least once — use {@link enumerateAudioInputs} to
   * fetch the list with labels.
   */
  deviceId?: string;
}

export class WebAudioCaptureProvider implements AudioCaptureProvider {
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

  constructor(private readonly opts: WebAudioCaptureOptions = {}) {}

  /**
   * Update the desired input device. Takes effect on the next `start()`.
   */
  setDeviceId(deviceId: string | undefined): void {
    (this.opts as { deviceId?: string }).deviceId = deviceId;
  }

  get state(): CaptureState {
    return this._state;
  }

  async start(): Promise<void> {
    if (this._state === 'capturing' || this._state === 'starting') return;
    this.transition('starting');
    try {
      const g = globalThis as unknown as WebAudioGlobals;
      const Ctx = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctx) throw new Error('AudioContext is not available in this environment');
      if (!g.navigator?.mediaDevices?.getUserMedia) {
        throw new Error('navigator.mediaDevices.getUserMedia is not available');
      }
      this.context = new Ctx();
      const audioConstraint: MediaTrackConstraints | true = this.opts.deviceId
        ? { deviceId: { exact: this.opts.deviceId } }
        : true;
      this.mediaStream = await g.navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
      });
      this.source = this.context.createMediaStreamSource(this.mediaStream);
      // ScriptProcessorNode is deprecated but universally supported. AudioWorklet
      // would be preferable but requires a separate worklet file which complicates
      // bundling for our purposes.
      const bufferSize = 4096;
      this.node = this.context.createScriptProcessor(bufferSize, 1, 1);
      this.node.onaudioprocess = (event: AudioProcessingEvent) => this.handleBuffer(event);
      this.source.connect(this.node);
      this.node.connect(this.context.destination);
      this.seq = 0;
      this.startMs = Date.now();
      this.transition('capturing');
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
    // Concatenate with leftover then slice into FRAME_SAMPLES frames.
    const merged = concatFloat32(this.leftover, downSampled);
    const fullFrames = Math.floor(merged.length / FRAME_SAMPLES);
    for (let i = 0; i < fullFrames; i++) {
      const start = i * FRAME_SAMPLES;
      const slice = merged.subarray(start, start + FRAME_SAMPLES);
      const samples = floatToInt16(slice);
      const frame: AudioFrame = {
        samples,
        seq: this.seq++,
        timestampMs: this.startMs + Math.round((this.seq * 1000 * FRAME_SAMPLES) / RESAMPLE_SAMPLE_RATE),
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

export interface AudioInputDeviceInfo {
  deviceId: string;
  /** Human label, e.g. "Built-in Microphone" or "AirPods Pro". May be empty
   *  before the user has granted mic permission at least once. */
  label: string;
  /** Empty for the first device returned by the browser; non-empty for the
   *  rest. Useful for grouping virtual devices belonging to the same
   *  physical hardware. */
  groupId: string;
}

/**
 * List the available audio input devices via
 * `navigator.mediaDevices.enumerateDevices()`. Returns `[]` when the API
 * is not available or the call fails.
 *
 * IMPORTANT: Browsers strip device labels until the user has granted mic
 * permission at least once. To get useful labels, call `getUserMedia({
 * audio: true })` once to obtain permission, then call this function.
 */
export async function enumerateAudioInputs(): Promise<AudioInputDeviceInfo[]> {
  const g = globalThis as unknown as WebAudioGlobals;
  const enumerate = g.navigator?.mediaDevices?.enumerateDevices?.bind(
    g.navigator.mediaDevices,
  );
  if (!enumerate) return [];
  try {
    const devices = await enumerate();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }));
  } catch {
    return [];
  }
}


