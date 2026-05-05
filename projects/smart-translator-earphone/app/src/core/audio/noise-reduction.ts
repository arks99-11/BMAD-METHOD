/**
 * Story 1.4 — Noise reduction primitives.
 *
 * Provides:
 *  - HighPassFilter: cascaded 1st-order high-pass stages (default 4 stages
 *    at a 100 Hz cutoff, ≈24 dB/octave) — removes low-frequency rumble,
 *    AC hum, and breath noise. See the HighPassFilter docstring below for
 *    the exact transfer function and trade-offs versus an N-th-order
 *    Butterworth biquad cascade.
 *  - SpectralSubtractionDenoiser: classic spectral subtraction for stationary
 *    background noise. Calibrates from a leading silence segment, then
 *    attenuates the noise floor across subsequent frames.
 *
 * Both are integer-clamped int16-in / int16-out operations so they can be
 * inserted into the hot path of the audio pipeline without forcing a float
 * conversion of each frame.
 */

import { FRAME_SAMPLES, SAMPLE_RATE_HZ } from './audio-types';

const INT16_MAX = 32_767;
const INT16_MIN = -32_768;

export interface HighPassFilterOptions {
  /** Cutoff frequency in Hz. Default 100 Hz. */
  cutoffHz: number;
  /** Number of cascaded 1st-order stages (24 dB/octave with 4 stages). */
  numStages: number;
}

/**
 * Multi-stage high-pass filter built by cascading first-order RC filters.
 * Each stage gives 6 dB/octave roll-off; the default 4 stages yield
 * 24 dB/octave — adequate for removing 50/60 Hz hum and low-frequency
 * rumble without significantly affecting speech in the 200–4000 Hz band.
 *
 * The single-stage transfer function is, via the bilinear transform:
 *   y[n] = a * (y[n-1] + x[n] - x[n-1])
 * where a = RC / (RC + dt), RC = 1 / (2*pi*fc), dt = 1/sample_rate.
 *
 * Note: cascading N first-order RC stages does NOT yield an N-th-order
 * Butterworth filter (which has poles spread on the unit circle). Cascaded
 * coincident-pole filters have more pass-band droop. For the purposes of
 * audio pre-conditioning before STT this is acceptable; if a flatter
 * pass-band is required, replace this implementation with a biquad-based
 * Butterworth section design.
 */
export class HighPassFilter {
  private readonly a: number;
  private readonly numStages: number;
  private readonly prevX: Float64Array;
  private readonly prevY: Float64Array;

  constructor(opts: Partial<HighPassFilterOptions> = {}) {
    const cutoffHz = opts.cutoffHz ?? 100;
    const numStages = opts.numStages ?? 4;
    if (cutoffHz <= 0 || cutoffHz >= SAMPLE_RATE_HZ / 2) {
      throw new Error(`cutoffHz (${cutoffHz}) must be in (0, ${SAMPLE_RATE_HZ / 2})`);
    }
    if (numStages < 1) {
      throw new Error(`numStages (${numStages}) must be >= 1`);
    }
    const dt = 1 / SAMPLE_RATE_HZ;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.a = rc / (rc + dt);
    this.numStages = numStages;
    this.prevX = new Float64Array(numStages);
    this.prevY = new Float64Array(numStages);
  }

  /** Process a frame in place if `out` is omitted; otherwise into `out`. */
  process(input: Int16Array, out?: Int16Array): Int16Array {
    const dst = out ?? input;
    if (dst.length !== input.length) {
      throw new Error('out length must match input length');
    }
    const a = this.a;
    const stages = this.numStages;
    for (let i = 0; i < input.length; i++) {
      let v = input[i]! as number;
      for (let s = 0; s < stages; s++) {
        const px = this.prevX[s]!;
        const py = this.prevY[s]!;
        const y = a * (py + v - px);
        this.prevX[s] = v;
        this.prevY[s] = y;
        v = y;
      }
      const clamped = v > INT16_MAX ? INT16_MAX : v < INT16_MIN ? INT16_MIN : v;
      dst[i] = Math.round(clamped);
    }
    return dst;
  }

  reset(): void {
    this.prevX.fill(0);
    this.prevY.fill(0);
  }
}

export interface DenoiserOptions {
  /** Subtraction strength: 1.0 cancels exactly the calibrated noise; >1.0
   *  over-subtracts and is more aggressive at the cost of artifacts. */
  alpha: number;
  /** Lower bound on the post-subtraction magnitude as a fraction of the
   *  pre-subtraction magnitude (avoids "musical noise" from going to zero). */
  beta: number;
}

const DEFAULT_DENOISER: DenoiserOptions = { alpha: 1.0, beta: 0.05 };

/**
 * Spectral subtraction denoiser working on FRAME_SAMPLES-sized frames using a
 * naive DFT (the frame is small — 320 samples — so the O(N^2) cost is
 * acceptable; production code would use FFT, but this keeps the dependency
 * surface to zero).
 *
 * Calibration: call `calibrate()` with leading silence frames before the first
 * speech frame. The denoiser estimates the per-bin noise magnitude as the
 * mean over the calibration set.
 *
 * Without calibration, `process()` is a no-op (returns input untouched) and
 * `calibrationPending` returns true so the orchestrator can surface a
 * "calibration-pending" event to the UI.
 */
export class SpectralSubtractionDenoiser {
  private readonly opts: DenoiserOptions;
  private noiseMag: Float64Array | null = null;
  private calibrationFrameCount = 0;

  constructor(options: Partial<DenoiserOptions> = {}) {
    this.opts = { ...DEFAULT_DENOISER, ...options };
  }

  get calibrationPending(): boolean {
    return this.noiseMag === null;
  }

  /** Add a frame to the calibration set. Call multiple times. */
  calibrate(frame: Int16Array): void {
    if (frame.length !== FRAME_SAMPLES) {
      throw new Error(`calibrate() expects FRAME_SAMPLES (${FRAME_SAMPLES}) samples`);
    }
    const mag = this.dftMagnitudes(frame);
    if (!this.noiseMag) {
      this.noiseMag = new Float64Array(mag.length);
    }
    for (let k = 0; k < mag.length; k++) {
      // Running mean.
      this.noiseMag[k] =
        (this.noiseMag[k]! * this.calibrationFrameCount + mag[k]!) /
        (this.calibrationFrameCount + 1);
    }
    this.calibrationFrameCount += 1;
  }

  /**
   * Process one frame. If calibration has not been performed yet, returns
   * the input unchanged (caller should handle the calibration-pending case
   * by checking `calibrationPending`).
   */
  process(input: Int16Array, out?: Int16Array): Int16Array {
    const dst = out ?? new Int16Array(input.length);
    if (input.length !== FRAME_SAMPLES) {
      throw new Error(`process() expects FRAME_SAMPLES (${FRAME_SAMPLES}) samples`);
    }
    if (!this.noiseMag) {
      // No calibration — pass through.
      if (dst !== input) dst.set(input);
      return dst;
    }
    const N = input.length;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let r = 0;
      let i = 0;
      for (let n = 0; n < N; n++) {
        const angle = (-2 * Math.PI * k * n) / N;
        r += input[n]! * Math.cos(angle);
        i += input[n]! * Math.sin(angle);
      }
      re[k] = r;
      im[k] = i;
    }
    // Subtract the noise magnitude per bin, then reconstruct.
    const reOut = new Float64Array(N);
    const imOut = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const mag = Math.hypot(re[k]!, im[k]!);
      const reduced = Math.max(mag - this.opts.alpha * this.noiseMag[k]!, this.opts.beta * mag);
      const scale = mag === 0 ? 0 : reduced / mag;
      reOut[k] = re[k]! * scale;
      imOut[k] = im[k]! * scale;
    }
    // Inverse DFT.
    for (let n = 0; n < N; n++) {
      let sum = 0;
      for (let k = 0; k < N; k++) {
        const angle = (2 * Math.PI * k * n) / N;
        sum += reOut[k]! * Math.cos(angle) - imOut[k]! * Math.sin(angle);
      }
      const v = sum / N;
      dst[n] = v > INT16_MAX ? INT16_MAX : v < INT16_MIN ? INT16_MIN : Math.round(v);
    }
    return dst;
  }

  reset(): void {
    this.noiseMag = null;
    this.calibrationFrameCount = 0;
  }

  /** Naive DFT magnitudes. Exposed for tests. */
  dftMagnitudes(frame: Int16Array): Float64Array {
    const N = frame.length;
    const out = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let r = 0;
      let i = 0;
      for (let n = 0; n < N; n++) {
        const angle = (-2 * Math.PI * k * n) / N;
        r += frame[n]! * Math.cos(angle);
        i += frame[n]! * Math.sin(angle);
      }
      out[k] = Math.hypot(r, i);
    }
    return out;
  }
}
