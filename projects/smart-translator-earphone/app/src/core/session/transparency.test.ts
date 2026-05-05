/**
 * Story 5.4 — Latency tracker unit tests.
 */

import { RollingLatencyTracker } from './transparency';

describe('RollingLatencyTracker', () => {
  it('returns undefined before any pushes', () => {
    const t = new RollingLatencyTracker();
    expect(t.mean('stt')).toBeUndefined();
    expect(t.mean('mt')).toBeUndefined();
    expect(t.mean('tts')).toBeUndefined();
  });

  it('reports the mean of the pushed values', () => {
    const t = new RollingLatencyTracker();
    t.push('stt', 100);
    t.push('stt', 200);
    t.push('stt', 300);
    expect(t.mean('stt')).toBe(200);
  });

  it('rolls off old values past capacity', () => {
    const t = new RollingLatencyTracker(3);
    t.push('mt', 1000);
    t.push('mt', 100);
    t.push('mt', 100);
    t.push('mt', 100); // drops 1000
    expect(t.mean('mt')).toBe(100);
  });

  it('keeps stages independent', () => {
    const t = new RollingLatencyTracker();
    t.push('stt', 100);
    t.push('mt', 500);
    t.push('tts', 900);
    expect(t.mean('stt')).toBe(100);
    expect(t.mean('mt')).toBe(500);
    expect(t.mean('tts')).toBe(900);
  });

  it('rounds the mean to an integer', () => {
    const t = new RollingLatencyTracker();
    t.push('tts', 100);
    t.push('tts', 101);
    expect(t.mean('tts')).toBe(101); // (100+101)/2=100.5 rounds to 101
  });

  it('rejects non-positive capacity', () => {
    expect(() => new RollingLatencyTracker(0)).toThrow(/positive/);
    expect(() => new RollingLatencyTracker(-1)).toThrow(/positive/);
  });
});
