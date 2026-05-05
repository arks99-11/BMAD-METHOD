/**
 * Epic 11 — telemetry ingest validator tests.
 */

import { IngestError, validateBatch } from './ingest';

describe('validateBatch', () => {
  it('accepts a valid batch', () => {
    const result = validateBatch({
      events: [
        { name: 'session.start', ts: 1, tags: { mode: 'lecture' } },
        { name: 'engine.fallback', ts: 2, tags: { from: 'deepgram', to: 'google' } },
      ],
    });
    expect(result.batch.events).toHaveLength(2);
    expect(result.rejections).toEqual([]);
  });

  it('throws if body is not an object', () => {
    expect(() => validateBatch(null)).toThrow(IngestError);
    expect(() => validateBatch('hi')).toThrow(IngestError);
  });

  it('throws if events is not an array', () => {
    expect(() => validateBatch({ events: 'no' })).toThrow(IngestError);
  });

  it('throws if batch exceeds maxBatchSize', () => {
    const events = Array.from({ length: 201 }, (_, i) => ({
      name: 'session.start',
      ts: i,
      tags: {},
    }));
    expect(() => validateBatch({ events })).toThrow(IngestError);
  });

  it('drops events with unknown names', () => {
    const result = validateBatch({
      events: [
        { name: 'session.start', ts: 1, tags: {} },
        { name: 'unknown.thing', ts: 2, tags: {} },
      ],
    });
    expect(result.batch.events).toHaveLength(1);
    expect(result.rejections[0]?.reason).toBe('unknown-event-name');
  });

  it('drops events with non-numeric ts', () => {
    const result = validateBatch({
      events: [{ name: 'session.start', ts: 'now', tags: {} }],
    });
    expect(result.batch.events).toHaveLength(0);
    expect(result.rejections[0]?.reason).toBe('invalid-ts');
  });

  it('drops events with negative ts', () => {
    const result = validateBatch({
      events: [{ name: 'session.start', ts: -1, tags: {} }],
    });
    expect(result.rejections[0]?.reason).toBe('invalid-ts');
  });

  it('drops events with non-object tags', () => {
    const result = validateBatch({
      events: [{ name: 'session.start', ts: 1, tags: 'no' }],
    });
    expect(result.rejections[0]?.reason).toBe('invalid-tag-value');
  });

  it('drops events with nested tag values', () => {
    const result = validateBatch({
      events: [{ name: 'session.start', ts: 1, tags: { x: { nested: 1 } } }],
    });
    expect(result.batch.events).toHaveLength(0);
    expect(result.rejections[0]?.reason).toBe('invalid-tag-value');
  });

  it('drops events with array tag values', () => {
    const result = validateBatch({
      events: [{ name: 'session.start', ts: 1, tags: { x: [1, 2] } }],
    });
    expect(result.rejections[0]?.reason).toBe('invalid-tag-value');
  });

  it('strips audio-bearing values (privacy backstop)', () => {
    // Buffer-like instances are also non-primitives, so they get
    // rejected by the same enum/number/boolean filter.
    const result = validateBatch({
      events: [
        {
          name: 'session.start',
          ts: 1,
          tags: { samples: new Float32Array([0.1, 0.2]) },
        },
      ],
    });
    expect(result.batch.events).toHaveLength(0);
    expect(result.rejections[0]?.reason).toBe('invalid-tag-value');
  });

  it('preserves valid string / number / boolean tags', () => {
    const result = validateBatch({
      events: [
        {
          name: 'engine.route',
          ts: 1,
          tags: { engine: 'azure', latencyMs: 220, fallback: false },
        },
      ],
    });
    expect(result.batch.events[0]?.tags).toEqual({
      engine: 'azure',
      latencyMs: 220,
      fallback: false,
    });
  });
});
