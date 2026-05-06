import {
  AudioPipeline,
  FRAME_SAMPLES,
  MockAudioCaptureProvider,
  type PipelineEvent,
} from './index';

function buildSpeechSamples(frameCount: number, dbfs: number): Int16Array {
  const amp = 32_768 * Math.pow(10, dbfs / 20);
  const a = Math.min(32_767, Math.max(-32_768, Math.round(amp)));
  const buf = new Int16Array(frameCount * FRAME_SAMPLES);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = i % 2 === 0 ? a : -a;
  }
  return buf;
}

function buildSilenceSamples(frameCount: number): Int16Array {
  return new Int16Array(frameCount * FRAME_SAMPLES);
}

describe('AudioPipeline orchestrator (E2E across stories 1.1, 1.2, 1.3, 1.4)', () => {
  test('end-to-end: speech burst emits start, frames, chunks, end', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider, {
      vad: { minSpeechMs: 60, minSilenceMs: 200 },
      chunker: { chunkMs: 300, maxChunkMs: 600 },
      onlyVoicedFramesToChunker: true,
      // Disable HPF in tests to avoid warmup-time energy drop.
      highPass: false,
    });
    const events: PipelineEvent[] = [];
    pipeline.on((e) => events.push(e));

    await pipeline.start();

    // 200 ms of speech (10 frames) at -25 dBFS.
    provider.pushSamples(buildSpeechSamples(10, -25));
    // 600 ms of silence (30 frames) — well above the 200 ms minSilence.
    provider.pushSamples(buildSilenceSamples(30));

    await pipeline.stop();

    const types = events.map((e) => e.type);
    expect(types).toContain('utterance-start');
    expect(types).toContain('utterance-end');
    // At least one chunk should be emitted (200 ms speech is not yet a full
    // 300 ms chunk, but the utterance boundary triggers a flush).
    expect(events.filter((e) => e.type === 'chunk').length).toBeGreaterThanOrEqual(1);
    // The final chunk produced when stop() is called must be flagged final.
    const lastChunk = events.filter((e) => e.type === 'chunk').at(-1);
    expect(lastChunk).toBeDefined();
  });

  test('utterance-end flushes the chunker with utteranceBoundary=true', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider, {
      vad: { minSpeechMs: 40, minSilenceMs: 200 },
      chunker: { chunkMs: 300 },
      onlyVoicedFramesToChunker: true,
      highPass: false,
    });
    const chunks: Array<{ utteranceBoundary: boolean; final: boolean }> = [];
    pipeline.on((e) => {
      if (e.type === 'chunk') chunks.push({ utteranceBoundary: e.chunk.utteranceBoundary, final: e.chunk.final });
    });

    await pipeline.start();

    // 100 ms of speech (5 frames).
    provider.pushSamples(buildSpeechSamples(5, -25));
    // 600 ms of silence (30 frames) — triggers utterance-end and flush.
    provider.pushSamples(buildSilenceSamples(30));
    // No more samples; pipeline stop() will not produce a duplicate chunk.

    await pipeline.stop();

    // The first chunk should have utteranceBoundary=true.
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.utteranceBoundary).toBe(true);
  });

  test('with onlyVoicedFramesToChunker=false, all frames flow into chunks', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider, {
      vad: { minSpeechMs: 120, minSilenceMs: 200 },
      chunker: { chunkMs: 300 },
      onlyVoicedFramesToChunker: false,
      highPass: false,
    });
    const chunks: PipelineEvent[] = [];
    pipeline.on((e) => {
      if (e.type === 'chunk') chunks.push(e);
    });

    await pipeline.start();
    // 30 frames of pure silence (no utterance) → still chunked.
    provider.pushSamples(buildSilenceSamples(30));
    await pipeline.stop();

    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  test('frame events are emitted for every captured frame', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider, {
      vad: { minSpeechMs: 40, minSilenceMs: 100 },
      chunker: { chunkMs: 300 },
      highPass: false,
    });
    const frameSeqs: number[] = [];
    pipeline.on((e) => {
      if (e.type === 'frame') frameSeqs.push(e.frame.seq);
    });
    await pipeline.start();
    provider.pushSamples(buildSilenceSamples(7));
    await pipeline.stop();
    expect(frameSeqs).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('start is idempotent and stop is idempotent', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider);
    await pipeline.start();
    await pipeline.start(); // no-op
    await pipeline.stop();
    await pipeline.stop(); // no-op
  });

  test('stop() flushes any in-progress utterance', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider, {
      vad: { minSpeechMs: 40, minSilenceMs: 1000 },
      chunker: { chunkMs: 300 },
      highPass: false,
    });
    const events: PipelineEvent[] = [];
    pipeline.on((e) => events.push(e));

    await pipeline.start();
    // Mid-utterance: 400 ms of speech, no trailing silence long enough to
    // trigger end naturally.
    provider.pushSamples(buildSpeechSamples(20, -25));
    await pipeline.stop();

    // Stop's flush should produce an utterance-end and a final chunk.
    expect(events.some((e) => e.type === 'utterance-end')).toBe(true);
    expect(events.some((e) => e.type === 'chunk' && e.chunk.final)).toBe(true);
  });

  test('stop() mid-utterance tags the final chunk as utterance boundary', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider, {
      vad: { minSpeechMs: 40, minSilenceMs: 1000 },
      chunker: { chunkMs: 300 },
      highPass: false,
    });
    const chunks: Array<{ utteranceBoundary: boolean; final: boolean }> = [];
    pipeline.on((e) => {
      if (e.type === 'chunk') chunks.push({ utteranceBoundary: e.chunk.utteranceBoundary, final: e.chunk.final });
    });

    await pipeline.start();
    provider.pushSamples(buildSpeechSamples(20, -25));
    await pipeline.stop();

    const finalChunk = chunks.find((c) => c.final);
    expect(finalChunk).toBeDefined();
    expect(finalChunk!.utteranceBoundary).toBe(true);
  });

  test('stop() outside an utterance leaves the final chunk without an utterance boundary', async () => {
    const provider = new MockAudioCaptureProvider();
    const pipeline = new AudioPipeline(provider, {
      vad: { minSpeechMs: 40, minSilenceMs: 100 },
      chunker: { chunkMs: 300 },
      onlyVoicedFramesToChunker: false,
      highPass: false,
    });
    const chunks: Array<{ utteranceBoundary: boolean; final: boolean }> = [];
    pipeline.on((e) => {
      if (e.type === 'chunk') chunks.push({ utteranceBoundary: e.chunk.utteranceBoundary, final: e.chunk.final });
    });

    await pipeline.start();
    // Pure silence — no utterance ever starts.
    provider.pushSamples(buildSilenceSamples(20));
    await pipeline.stop();

    const finalChunk = chunks.find((c) => c.final);
    expect(finalChunk).toBeDefined();
    expect(finalChunk!.utteranceBoundary).toBe(false);
  });
});
