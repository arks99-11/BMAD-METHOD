/**
 * Unit tests for WebTabAudioCaptureProvider.
 *
 * The Web Audio API is not available in jsdom, so we install minimal fakes
 * for `AudioContext`, `MediaStream`, and `navigator.mediaDevices.getDisplayMedia`
 * directly on `globalThis` for the duration of each test.
 */

import {
  WebTabAudioCaptureProvider,
  isTabAudioCaptureSupported,
} from './web-tab-audio-capture';

interface FakeTrack {
  kind: 'audio' | 'video';
  stopped: boolean;
  endedListeners: Array<() => void>;
  stop: () => void;
  addEventListener: (event: string, cb: () => void) => void;
}

function makeTrack(kind: 'audio' | 'video'): FakeTrack {
  const t: FakeTrack = {
    kind,
    stopped: false,
    endedListeners: [],
    stop: () => {
      t.stopped = true;
    },
    addEventListener: (event, cb) => {
      if (event === 'ended') t.endedListeners.push(cb);
    },
  };
  return t;
}

function makeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as unknown as MediaStream;
}

class FakeScriptProcessor {
  public onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
  public connected: number[] = [];
  public disconnectCount = 0;
  connect(_dest: unknown): void {
    this.connected.push(1);
  }
  disconnect(): void {
    this.disconnectCount += 1;
  }
}

class FakeAudioContext {
  sampleRate = 48000;
  destination = {} as AudioDestinationNode;
  closeCount = 0;
  lastNode: FakeScriptProcessor | null = null;
  createMediaStreamSource(_stream: MediaStream): MediaStreamAudioSourceNode {
    return {
      connect: () => undefined,
      disconnect: () => undefined,
    } as unknown as MediaStreamAudioSourceNode;
  }
  createScriptProcessor(_size: number, _in: number, _out: number): ScriptProcessorNode {
    const node = new FakeScriptProcessor();
    this.lastNode = node;
    return node as unknown as ScriptProcessorNode;
  }
  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

interface GlobalShape {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
  navigator?: { mediaDevices?: { getDisplayMedia?: unknown } };
}

function installGlobals(opts: {
  getDisplayMedia: ((c: unknown) => Promise<MediaStream>) | undefined;
}): { restore: () => void; ctx: FakeAudioContext | null } {
  const g = globalThis as unknown as GlobalShape;
  const original = {
    AudioContext: g.AudioContext,
    webkitAudioContext: g.webkitAudioContext,
    navigator: g.navigator,
  };
  let lastCtx: FakeAudioContext | null = null;
  // Wrap the constructor so the test can grab the instance.
  const Ctx = function () {
    const c = new FakeAudioContext();
    lastCtx = c;
    return c;
  } as unknown as typeof AudioContext;
  g.AudioContext = Ctx;
  g.webkitAudioContext = undefined;
  g.navigator = {
    mediaDevices: {
      getDisplayMedia: opts.getDisplayMedia,
    },
  };
  return {
    restore: () => {
      g.AudioContext = original.AudioContext;
      g.webkitAudioContext = original.webkitAudioContext;
      g.navigator = original.navigator;
    },
    get ctx() {
      return lastCtx;
    },
  };
}

describe('WebTabAudioCaptureProvider', () => {
  it('isTabAudioCaptureSupported() is false when getDisplayMedia is missing', () => {
    const env = installGlobals({ getDisplayMedia: undefined });
    try {
      expect(isTabAudioCaptureSupported()).toBe(false);
    } finally {
      env.restore();
    }
  });

  it('isTabAudioCaptureSupported() is true when getDisplayMedia is available', () => {
    const env = installGlobals({ getDisplayMedia: async () => makeStream([]) });
    try {
      expect(isTabAudioCaptureSupported()).toBe(true);
    } finally {
      env.restore();
    }
  });

  it('throws a clear error when getDisplayMedia is not available', async () => {
    const env = installGlobals({ getDisplayMedia: undefined });
    try {
      const p = new WebTabAudioCaptureProvider();
      await expect(p.start()).rejects.toThrow(/getDisplayMedia is not available/);
    } finally {
      env.restore();
    }
  });

  it('throws when the shared stream has no audio track', async () => {
    const videoOnly = makeStream([makeTrack('video')]);
    const env = installGlobals({ getDisplayMedia: async () => videoOnly });
    try {
      const p = new WebTabAudioCaptureProvider();
      await expect(p.start()).rejects.toThrow(/No audio track/);
      // Video track should be torn down on failure.
      expect(videoOnly.getVideoTracks()[0]!.stopped).toBe(true);
    } finally {
      env.restore();
    }
  });

  it('starts successfully with an audio track and stops video track', async () => {
    const audio = makeTrack('audio');
    const video = makeTrack('video');
    const stream = makeStream([audio, video]);
    const env = installGlobals({ getDisplayMedia: async () => stream });
    try {
      const p = new WebTabAudioCaptureProvider();
      const states: string[] = [];
      p.onState((s) => states.push(s));
      await p.start();
      expect(p.state).toBe('capturing');
      expect(states).toContain('starting');
      expect(states).toContain('capturing');
      // Video track is dropped immediately.
      expect(video.stopped).toBe(true);
      // Audio track is kept alive (we're capturing from it).
      expect(audio.stopped).toBe(false);
      await p.stop();
      // Stop tears down everything including the audio track.
      expect(audio.stopped).toBe(true);
    } finally {
      env.restore();
    }
  });

  it('emits frames downsampled to 16 kHz from a 48 kHz source', async () => {
    const audio = makeTrack('audio');
    const stream = makeStream([audio]);
    const env = installGlobals({ getDisplayMedia: async () => stream });
    try {
      const p = new WebTabAudioCaptureProvider();
      const frames: number[] = [];
      p.onFrame((f) => frames.push(f.samples.length));
      await p.start();
      // Drive a synthetic onaudioprocess event with 9600 samples @ 48 kHz
      // → 3200 @ 16 kHz → 10 frames of 320.
      const ctx = env.ctx!;
      const node = ctx.lastNode!;
      const data = new Float32Array(9600);
      for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.01);
      const evt = {
        inputBuffer: {
          getChannelData: () => data,
        },
      } as unknown as AudioProcessingEvent;
      node.onaudioprocess?.(evt);
      expect(frames.length).toBe(10);
      for (const len of frames) expect(len).toBe(320);
      await p.stop();
    } finally {
      env.restore();
    }
  });

  it('auto-stops when the audio track ends (user clicks Stop sharing)', async () => {
    const audio = makeTrack('audio');
    const stream = makeStream([audio]);
    const env = installGlobals({ getDisplayMedia: async () => stream });
    try {
      const p = new WebTabAudioCaptureProvider();
      await p.start();
      expect(p.state).toBe('capturing');
      // Simulate user clicking "Stop sharing" in the screen-share chip.
      for (const cb of audio.endedListeners) cb();
      // Allow the async stop() to settle.
      await new Promise((r) => setTimeout(r, 0));
      expect(p.state).toBe('idle');
    } finally {
      env.restore();
    }
  });

  it('start() is idempotent (no-op when already capturing)', async () => {
    const audio = makeTrack('audio');
    const stream = makeStream([audio]);
    let getCallCount = 0;
    const env = installGlobals({
      getDisplayMedia: async () => {
        getCallCount += 1;
        return stream;
      },
    });
    try {
      const p = new WebTabAudioCaptureProvider();
      await p.start();
      await p.start();
      expect(getCallCount).toBe(1);
      await p.stop();
    } finally {
      env.restore();
    }
  });
});
