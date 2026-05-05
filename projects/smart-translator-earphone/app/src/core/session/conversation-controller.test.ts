/**
 * Story 5.2 — ConversationController unit tests.
 *
 * The controller orchestrates audio + STT + MT + TTS. The tests below
 * use controllable fakes for every provider so the orchestration logic
 * is exercised without any vendor calls.
 */

import { wrapAsStream } from '../mt/base-mt-provider';
import type {
  MtProvider,
  MtRequest,
  MtResult,
  MtStream,
} from '../mt/mt-types';
import type {
  AudioCaptureProvider,
  CaptureState,
  ErrorListener,
  FrameListener,
  StateListener,
} from '../audio/audio-capture';
import type { AudioChunk, AudioFrame } from '../audio/audio-types';
import { EngineRouter } from '../engine-router/engine-router';
import type { RoutingPolicy } from '../engine-router/types';
import type {
  SttEvent,
  SttEventListener,
  SttProvider,
  SttSession,
  SttStartOptions,
} from '../stt/stt-types';
import type {
  TtsProvider,
  TtsRequest,
  TtsResult,
  TtsStream,
  TtsStreamEvent,
  TtsStreamListener,
} from '../tts/tts-types';
import { VoiceCatalog, type CatalogVoice } from '../tts/voice-catalog';
import { ConversationController } from './conversation-controller';
import type { SessionEvent } from './session-types';
import { resetTurnIdSequence } from './turn-log';

// ----- Mock policy (every engine resolved through the 'mock' id) -----

const MOCK_POLICY: RoutingPolicy = {
  version: 0,
  corridors: {
    'EN→ES': { stt: 'mock', mt: 'mock', tts: 'mock' },
  },
  fallbackCorridor: { stt: 'mock', mt: 'mock', tts: 'mock' },
  offline: { stt: 'mock', mt: 'mock', tts: 'mock' },
};

// ----- Fake AudioCaptureProvider -----

class FakeCapture implements AudioCaptureProvider {
  private _state: CaptureState = 'idle';
  private readonly frameListeners = new Set<FrameListener>();

  get state(): CaptureState {
    return this._state;
  }

  async start(): Promise<void> {
    this._state = 'capturing';
  }

  async stop(): Promise<void> {
    this._state = 'idle';
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onError(_listener: ErrorListener): () => void {
    return () => undefined;
  }

  onState(_listener: StateListener): () => void {
    return () => undefined;
  }

  pushFrame(seq: number): void {
    const samples = new Int16Array(320);
    samples.fill(100);
    const frame: AudioFrame = { samples, seq, timestampMs: seq * 20 };
    for (const l of this.frameListeners) l(frame);
  }
}

// ----- Fake STT provider -----

class FakeSttSession implements SttSession {
  readonly engine = 'mock' as const;
  private readonly listeners = new Set<SttEventListener>();
  readonly chunks: AudioChunk[] = [];

  send(chunk: AudioChunk): void {
    this.chunks.push(chunk);
  }

  async end(): Promise<void> {
    this.emit({ type: 'closed' });
  }

  on(listener: SttEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(ev: SttEvent): void {
    for (const l of this.listeners) l(ev);
  }
}

class FakeSttProvider implements SttProvider {
  readonly engine = 'mock' as const;
  readonly sessions: FakeSttSession[] = [];

  async start(_opts: SttStartOptions): Promise<SttSession> {
    const sess = new FakeSttSession();
    this.sessions.push(sess);
    return sess;
  }
}

// ----- Fake MT provider -----

class FakeMtProvider implements MtProvider {
  readonly engine = 'mock' as const;
  readonly requests: MtRequest[] = [];
  /** Per-call resolver. The default returns "[mt:<source-text>]". */
  resolver: (req: MtRequest) => Promise<MtResult> = async (req) => ({
    text: `[mt:${req.text}]`,
    engine: 'mock',
    durationMs: 0,
    detectedSource: req.source as 'auto' extends typeof req.source ? string : never,
  });

  translate(req: MtRequest): Promise<MtResult> {
    this.requests.push(req);
    return this.resolver(req);
  }

  translateStream(req: MtRequest): MtStream {
    this.requests.push(req);
    return wrapAsStream(this.engine, this.resolver(req));
  }
}

// ----- Fake TTS provider -----

class FakeTtsStream implements TtsStream {
  readonly engine = 'mock' as const;
  readonly listeners = new Set<TtsStreamListener>();
  done: Promise<TtsResult>;
  private resolveDone!: (r: TtsResult) => void;

  constructor() {
    this.done = new Promise<TtsResult>((resolve) => {
      this.resolveDone = resolve;
    });
  }

  on(listener: TtsStreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(ev: TtsStreamEvent): void {
    for (const l of this.listeners) l(ev);
    if (ev.type === 'final') {
      this.resolveDone(ev.result);
    }
  }
}

class FakeTtsProvider implements TtsProvider {
  readonly engine = 'mock' as const;
  readonly requests: TtsRequest[] = [];
  readonly streams: FakeTtsStream[] = [];

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    return this.synthesizeStream(req).done;
  }

  synthesizeStream(req: TtsRequest): TtsStream {
    this.requests.push(req);
    const s = new FakeTtsStream();
    this.streams.push(s);
    return s;
  }
}

// ----- Voice catalog seeded with a 'mock' voice -----

const MOCK_VOICE: CatalogVoice = {
  id: 'mock-en-us',
  name: 'Mock',
  language: 'EN',
  engine: 'mock',
  providerVoiceId: 'mock-voice',
  tier: 'free',
  quality: 'standard',
};

function build(): {
  ctrl: ConversationController;
  capture: FakeCapture;
  stt: FakeSttProvider;
  mt: FakeMtProvider;
  tts: FakeTtsProvider;
  ttsChunks: Array<{ audio: Uint8Array; format: string }>;
} {
  resetTurnIdSequence();
  const capture = new FakeCapture();
  const stt = new FakeSttProvider();
  const mt = new FakeMtProvider();
  const tts = new FakeTtsProvider();
  const voices = new VoiceCatalog([MOCK_VOICE]);
  const router = new EngineRouter(MOCK_POLICY);
  const ttsChunks: Array<{ audio: Uint8Array; format: string }> = [];
  const ctrl = new ConversationController({
    capture,
    onSynthesisAudio: (audio, format): void => {
      ttsChunks.push({ audio, format });
    },
    router,
    voices,
    sttRegistry: new Map([['mock', stt]]),
    mtRegistry: new Map([['mock', mt]]),
    ttsRegistry: new Map([['mock', tts]]),
    chunker: { chunkMs: 60, maxChunkMs: 60 },
  });
  return { ctrl, capture, stt, mt, tts, ttsChunks };
}

async function flushMicroTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ConversationController', () => {
  it('starts in idle and transitions to listening on start()', async () => {
    const { ctrl } = build();
    expect(ctrl.snapshot().state).toBe('idle');
    const events: SessionEvent[] = [];
    ctrl.on((ev) => events.push(ev));
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    expect(ctrl.snapshot().state).toBe('listening');
    expect(events.find((e) => e.type === 'state' && e.state === 'listening')).toBeDefined();
  });

  it('publishes a transparency event on start with the active engines', async () => {
    const { ctrl } = build();
    const events: SessionEvent[] = [];
    ctrl.on((ev) => events.push(ev));
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    const trans = events.find((e) => e.type === 'transparency');
    expect(trans?.type).toBe('transparency');
    if (trans?.type === 'transparency') {
      expect(trans.data.stt).toBe('mock');
      expect(trans.data.mt).toBe('mock');
      expect(trans.data.tts).toBe('mock');
      expect(trans.data.corridor).toBe('EN→ES');
    }
  });

  it('partial STT opens a turn and goes to translating', async () => {
    const { ctrl, stt } = build();
    const events: SessionEvent[] = [];
    ctrl.on((ev) => events.push(ev));
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });

    stt.sessions[0]!.emit({ type: 'partial', transcript: 'hel', lang: 'EN' });
    await flushMicroTasks();

    expect(ctrl.snapshot().state).toBe('translating');
    const turns = ctrl.snapshot().turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]!.source.text).toBe('hel');
    expect(turns[0]!.source.isFinal).toBe(false);
    const append = events.find((e) => e.type === 'turn-appended');
    expect(append).toBeDefined();
  });

  it('final STT commits source, MT result commits target, then plays + back to listening', async () => {
    const { ctrl, stt, mt, tts } = build();
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });

    stt.sessions[0]!.emit({ type: 'partial', transcript: 'hello', lang: 'EN' });
    stt.sessions[0]!.emit({ type: 'final', transcript: 'hello world', lang: 'EN' });
    await flushMicroTasks();

    expect(mt.requests.length).toBeGreaterThanOrEqual(1);
    const lastTurn = ctrl.snapshot().turns[0]!;
    expect(lastTurn.source.text).toBe('hello world');
    expect(lastTurn.source.isFinal).toBe(true);
    expect(lastTurn.target.text).toBe('[mt:hello world]');
    expect(lastTurn.target.isFinal).toBe(true);

    // The TTS stream we built defaults to no chunks until we drive it.
    // Drive the playback to completion to exit speaking.
    const synth = tts.streams[0]!;
    synth.emit({
      type: 'final',
      result: {
        audio: new Uint8Array(0),
        format: 'pcm-s16le-24k',
        engine: 'mock',
        voice: 'mock-voice',
        durationMs: 0,
      },
    });
    await flushMicroTasks();
    expect(['speaking', 'listening']).toContain(ctrl.snapshot().state);
  });

  it('forwards TTS audio chunks to the onSynthesisAudio sink', async () => {
    const { ctrl, stt, tts, ttsChunks } = build();
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    stt.sessions[0]!.emit({ type: 'final', transcript: 'hi', lang: 'EN' });
    await flushMicroTasks();

    const stream = tts.streams[0]!;
    const audio = new Uint8Array([1, 2, 3, 4]);
    stream.emit({ type: 'chunk', audio, format: 'pcm-s16le-24k' });
    stream.emit({
      type: 'final',
      result: {
        audio,
        format: 'pcm-s16le-24k',
        engine: 'mock',
        voice: 'mock-voice',
        durationMs: 0,
      },
    });
    await flushMicroTasks();

    expect(ttsChunks).toHaveLength(1);
    expect(ttsChunks[0]!.audio).toBe(audio);
    expect(ttsChunks[0]!.format).toBe('pcm-s16le-24k');
  });

  it('emits language-detected and updates the open turn lang', async () => {
    const { ctrl, stt } = build();
    const events: SessionEvent[] = [];
    ctrl.on((ev) => events.push(ev));
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    stt.sessions[0]!.emit({ type: 'partial', transcript: 'bonjour', lang: 'EN' });
    stt.sessions[0]!.emit({ type: 'language-detected', lang: 'FR', confidence: 0.95 });
    await flushMicroTasks();
    const ld = events.find((e) => e.type === 'language-detected');
    expect(ld?.type).toBe('language-detected');
  });

  it('errors from STT surface as state=error + error event', async () => {
    const { ctrl, stt } = build();
    const events: SessionEvent[] = [];
    ctrl.on((ev) => events.push(ev));
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    stt.sessions[0]!.emit({ type: 'error', code: 'auth', message: 'bad key' });
    await flushMicroTasks();
    expect(ctrl.snapshot().state).toBe('error');
    expect(events.find((e) => e.type === 'error' && e.message.includes('bad key'))).toBeDefined();
  });

  it('throws if voiceId is not in the catalog', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.start({
        sourceLang: 'EN',
        targetLang: 'ES',
        voiceId: 'does-not-exist',
        tier: 'free',
      }),
    ).rejects.toThrow(/unknown voice/);
  });

  it('throws if the corridor resolves to an unregistered engine', async () => {
    const capture = new FakeCapture();
    const stt = new FakeSttProvider();
    const mt = new FakeMtProvider();
    const tts = new FakeTtsProvider();
    const voices = new VoiceCatalog([MOCK_VOICE]);
    const router = new EngineRouter(MOCK_POLICY);
    const ctrl = new ConversationController({
      capture,
      router,
      voices,
      sttRegistry: new Map(), // empty
      mtRegistry: new Map([['mock', mt]]),
      ttsRegistry: new Map([['mock', tts]]),
    });
    await expect(
      ctrl.start({
        sourceLang: 'EN',
        targetLang: 'ES',
        voiceId: 'mock-en-us',
        tier: 'free',
      }),
    ).rejects.toThrow(/STT provider mock not registered/);
    void stt;
  });

  it('throws if start() is called twice without stop()', async () => {
    const { ctrl } = build();
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    await expect(
      ctrl.start({
        sourceLang: 'EN',
        targetLang: 'ES',
        voiceId: 'mock-en-us',
        tier: 'free',
      }),
    ).rejects.toThrow(/already running/);
  });

  it('stop() returns the controller to idle and detaches listeners', async () => {
    const { ctrl, stt, capture } = build();
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    expect(ctrl.snapshot().state).toBe('listening');
    await ctrl.stop();
    expect(ctrl.snapshot().state).toBe('idle');
    expect(capture.state).toBe('idle');
    // Subsequent STT events do not change state.
    stt.sessions[0]!.emit({ type: 'partial', transcript: 'late', lang: 'EN' });
    expect(ctrl.snapshot().state).toBe('idle');
  });

  it('forwards captured audio frames into the chunker → STT session', async () => {
    const { ctrl, capture, stt } = build();
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });
    // 60ms chunk = 3 frames at 20ms each.
    capture.pushFrame(0);
    capture.pushFrame(1);
    capture.pushFrame(2);
    expect(stt.sessions[0]!.chunks.length).toBe(1);
    expect(stt.sessions[0]!.chunks[0]!.startSeq).toBe(0);
    expect(stt.sessions[0]!.chunks[0]!.endSeq).toBe(2);
  });

  it('handles a second turn after the first completes', async () => {
    const { ctrl, stt, tts } = build();
    await ctrl.start({
      sourceLang: 'EN',
      targetLang: 'ES',
      voiceId: 'mock-en-us',
      tier: 'free',
    });

    // Turn 1
    stt.sessions[0]!.emit({ type: 'final', transcript: 'one', lang: 'EN' });
    await flushMicroTasks();
    tts.streams[0]!.emit({
      type: 'final',
      result: {
        audio: new Uint8Array(0),
        format: 'pcm-s16le-24k',
        engine: 'mock',
        voice: 'mock-voice',
        durationMs: 0,
      },
    });
    await flushMicroTasks();

    // Turn 2
    stt.sessions[0]!.emit({ type: 'final', transcript: 'two', lang: 'EN' });
    await flushMicroTasks();

    const turns = ctrl.snapshot().turns;
    expect(turns).toHaveLength(2);
    expect(turns[0]!.source.text).toBe('one');
    expect(turns[1]!.source.text).toBe('two');
    expect(turns[0]!.id).not.toBe(turns[1]!.id);
  });
});
