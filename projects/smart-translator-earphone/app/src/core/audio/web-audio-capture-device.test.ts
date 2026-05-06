/**
 * Tests focused on the deviceId option of WebAudioCaptureProvider and the
 * enumerateAudioInputs() helper. The frame-emission / state-machine
 * behaviour is already covered by audio-capture.test.ts via the mock
 * provider; here we only verify that the deviceId is plumbed correctly
 * into getUserMedia and that enumeration filters to audioinputs.
 */

import {
  WebAudioCaptureProvider,
  enumerateAudioInputs,
} from './web-audio-capture';

interface FakeMediaDevices {
  getUserMedia: jest.Mock<Promise<MediaStream>, [MediaStreamConstraints]>;
  enumerateDevices?: jest.Mock<Promise<MediaDeviceInfo[]>, []>;
}

interface GlobalShape {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
  navigator?: { mediaDevices?: FakeMediaDevices };
}

class FakeAudioContext {
  sampleRate = 48000;
  destination = {} as AudioDestinationNode;
  createMediaStreamSource() {
    return { connect: () => undefined, disconnect: () => undefined } as unknown as MediaStreamAudioSourceNode;
  }
  createScriptProcessor() {
    return {
      onaudioprocess: null,
      connect: () => undefined,
      disconnect: () => undefined,
    } as unknown as ScriptProcessorNode;
  }
  async close() {
    /* noop */
  }
}

function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: () => undefined } as MediaStreamTrack],
  } as unknown as MediaStream;
}

function install(devices?: MediaDeviceInfo[]): { md: FakeMediaDevices; restore: () => void } {
  const g = globalThis as unknown as GlobalShape;
  const original = {
    AudioContext: g.AudioContext,
    webkitAudioContext: g.webkitAudioContext,
    navigator: g.navigator,
  };
  const md: FakeMediaDevices = {
    getUserMedia: jest.fn(async () => fakeStream()),
    enumerateDevices:
      devices !== undefined ? jest.fn(async () => devices) : undefined,
  };
  g.AudioContext = function () {
    return new FakeAudioContext();
  } as unknown as typeof AudioContext;
  g.webkitAudioContext = undefined;
  g.navigator = { mediaDevices: md };
  return {
    md,
    restore: () => {
      g.AudioContext = original.AudioContext;
      g.webkitAudioContext = original.webkitAudioContext;
      g.navigator = original.navigator;
    },
  };
}

describe('WebAudioCaptureProvider deviceId option', () => {
  it('omits deviceId constraint when no deviceId is provided', async () => {
    const env = install();
    try {
      const p = new WebAudioCaptureProvider();
      await p.start();
      expect(env.md.getUserMedia).toHaveBeenCalledWith({ audio: true });
      await p.stop();
    } finally {
      env.restore();
    }
  });

  it('passes deviceId through getUserMedia constraint when set in constructor', async () => {
    const env = install();
    try {
      const p = new WebAudioCaptureProvider({ deviceId: 'airpods-123' });
      await p.start();
      expect(env.md.getUserMedia).toHaveBeenCalledWith({
        audio: { deviceId: { exact: 'airpods-123' } },
      });
      await p.stop();
    } finally {
      env.restore();
    }
  });

  it('setDeviceId() updates the device used for the next start', async () => {
    const env = install();
    try {
      const p = new WebAudioCaptureProvider();
      p.setDeviceId('mic-A');
      await p.start();
      expect(env.md.getUserMedia).toHaveBeenLastCalledWith({
        audio: { deviceId: { exact: 'mic-A' } },
      });
      await p.stop();
      p.setDeviceId('mic-B');
      await p.start();
      expect(env.md.getUserMedia).toHaveBeenLastCalledWith({
        audio: { deviceId: { exact: 'mic-B' } },
      });
      await p.stop();
    } finally {
      env.restore();
    }
  });

  it('setDeviceId(undefined) reverts to the OS default', async () => {
    const env = install();
    try {
      const p = new WebAudioCaptureProvider({ deviceId: 'airpods-123' });
      p.setDeviceId(undefined);
      await p.start();
      expect(env.md.getUserMedia).toHaveBeenCalledWith({ audio: true });
      await p.stop();
    } finally {
      env.restore();
    }
  });
});

describe('enumerateAudioInputs', () => {
  it('returns [] when enumerateDevices is unavailable', async () => {
    const env = install();
    try {
      const list = await enumerateAudioInputs();
      expect(list).toEqual([]);
    } finally {
      env.restore();
    }
  });

  it('filters results to audioinput kind', async () => {
    const env = install([
      { deviceId: 'a', kind: 'audioinput', label: 'Built-in', groupId: 'g1' } as MediaDeviceInfo,
      { deviceId: 'b', kind: 'videoinput', label: 'Camera', groupId: 'g2' } as MediaDeviceInfo,
      { deviceId: 'c', kind: 'audiooutput', label: 'Speakers', groupId: 'g3' } as MediaDeviceInfo,
      { deviceId: 'd', kind: 'audioinput', label: 'AirPods', groupId: 'g4' } as MediaDeviceInfo,
    ]);
    try {
      const list = await enumerateAudioInputs();
      expect(list.map((d) => d.deviceId)).toEqual(['a', 'd']);
      expect(list.map((d) => d.label)).toEqual(['Built-in', 'AirPods']);
    } finally {
      env.restore();
    }
  });

  it('returns [] when enumerateDevices throws', async () => {
    const env = install([]);
    env.md.enumerateDevices!.mockRejectedValueOnce(new Error('permission denied'));
    try {
      const list = await enumerateAudioInputs();
      expect(list).toEqual([]);
    } finally {
      env.restore();
    }
  });

  it('preserves empty labels (browser strips them before permission grant)', async () => {
    const env = install([
      { deviceId: 'a', kind: 'audioinput', label: '', groupId: '' } as MediaDeviceInfo,
    ]);
    try {
      const list = await enumerateAudioInputs();
      expect(list).toHaveLength(1);
      expect(list[0]!.label).toBe('');
      expect(list[0]!.deviceId).toBe('a');
    } finally {
      env.restore();
    }
  });
});
