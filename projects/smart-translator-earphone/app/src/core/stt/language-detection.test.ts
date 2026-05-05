/**
 * Story 2.4 — language-detection policy tests.
 */

import { LanguageDetectionPolicy, type DetectionResult } from './language-detection';
import type { SttEvent } from './stt-types';

function makeDetection(lang: string, confidence: number): SttEvent {
  return { type: 'language-detected', lang, confidence };
}

describe('Story 2.4 — LanguageDetectionPolicy', () => {
  test('suppresses detection until ≥ 4 s of audio has been seen', () => {
    const policy = new LanguageDetectionPolicy();
    const out: DetectionResult[] = [];
    policy.on((r) => out.push(r));
    policy.recordAudio(2_000);
    policy.apply(makeDetection('es-ES', 0.95));
    expect(out).toHaveLength(0);
    policy.recordAudio(2_000); // total now 4_000
    policy.apply(makeDetection('es-ES', 0.95));
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('confirmed');
  });

  test('confirmed when confidence >= 0.7 (default threshold)', () => {
    const policy = new LanguageDetectionPolicy();
    policy.recordAudio(5_000);
    const result = policy.apply(makeDetection('es-ES', 0.7));
    expect(result?.kind).toBe('confirmed');
  });

  test('needs-confirmation when 0.3 ≤ confidence < 0.7', () => {
    const policy = new LanguageDetectionPolicy();
    policy.recordAudio(5_000);
    const result = policy.apply(makeDetection('es-ES', 0.5));
    expect(result?.kind).toBe('needs-confirmation');
  });

  test('rejected detections still consume the emit-once budget (no chip flicker)', () => {
    const policy = new LanguageDetectionPolicy();
    const out: DetectionResult[] = [];
    policy.on((r) => out.push(r));
    policy.recordAudio(5_000);
    expect(policy.apply(makeDetection('es-ES', 0.1))).toBeNull(); // rejected
    expect(policy.apply(makeDetection('es-ES', 0.95))).toBeNull(); // suppressed
    expect(out).toHaveLength(0);
  });

  test('reset() re-arms the policy', () => {
    const policy = new LanguageDetectionPolicy();
    policy.recordAudio(5_000);
    policy.apply(makeDetection('es-ES', 0.95));
    policy.reset();
    expect(policy.apply(makeDetection('es-ES', 0.95))).toBeNull(); // audio counter reset
    policy.recordAudio(5_000);
    const result = policy.apply(makeDetection('es-ES', 0.95));
    expect(result?.kind).toBe('confirmed');
  });

  test('emitOnce=false allows multiple detections per session', () => {
    const policy = new LanguageDetectionPolicy({ emitOnce: false });
    policy.recordAudio(5_000);
    const a = policy.apply(makeDetection('es-ES', 0.95));
    const b = policy.apply(makeDetection('it-IT', 0.85));
    expect(a?.lang).toBe('es-ES');
    expect(b?.lang).toBe('it-IT');
  });

  test('non-language-detected events are passthrough nulls', () => {
    const policy = new LanguageDetectionPolicy();
    policy.recordAudio(5_000);
    expect(
      policy.apply({ type: 'partial', transcript: 'hi', lang: 'en-US' } as SttEvent),
    ).toBeNull();
    expect(policy.apply({ type: 'closed' } as SttEvent)).toBeNull();
  });

  test('custom thresholds reorder the boundaries', () => {
    const policy = new LanguageDetectionPolicy({
      confirmThreshold: 0.9,
      minPromptThreshold: 0.5,
      minAudioMs: 1_000,
    });
    policy.recordAudio(2_000);
    expect(policy.apply(makeDetection('es-ES', 0.92))?.kind).toBe('confirmed');
    policy.reset();
    policy.recordAudio(2_000);
    expect(policy.apply(makeDetection('es-ES', 0.6))?.kind).toBe('needs-confirmation');
    policy.reset();
    policy.recordAudio(2_000);
    expect(policy.apply(makeDetection('es-ES', 0.4))).toBeNull(); // rejected
  });

  test('rejects construction when confirmThreshold < minPromptThreshold', () => {
    expect(
      () => new LanguageDetectionPolicy({ confirmThreshold: 0.3, minPromptThreshold: 0.5 }),
    ).toThrow(/Threshold/);
  });

  test('negative durations are ignored', () => {
    const policy = new LanguageDetectionPolicy();
    policy.recordAudio(-1_000);
    policy.recordAudio(5_000);
    expect(policy.apply(makeDetection('es-ES', 0.95))?.kind).toBe('confirmed');
  });

  test('listeners can be unsubscribed', () => {
    const policy = new LanguageDetectionPolicy();
    const calls: DetectionResult[] = [];
    const off = policy.on((r) => calls.push(r));
    policy.recordAudio(5_000);
    off();
    policy.apply(makeDetection('es-ES', 0.95));
    expect(calls).toHaveLength(0);
  });
});
