import {
  classifyDeviceLabel,
  NullAudioDeviceMonitor,
  type AudioDeviceSnapshot,
} from './audio-device-monitor';
import { WebAudioDeviceMonitor } from './web-audio-device-monitor';

describe('classifyDeviceLabel', () => {
  it('classifies AirPods as bluetooth', () => {
    expect(classifyDeviceLabel('AirPods Pro')).toBe('bluetooth');
  });

  it('classifies Bose QC headphones as bluetooth', () => {
    expect(classifyDeviceLabel('Bose QuietComfort 45')).toBe('bluetooth');
  });

  it('classifies wired headset as wired', () => {
    expect(classifyDeviceLabel('USB Headphones')).toBe('wired');
  });

  it('classifies built-in speaker as speaker', () => {
    expect(classifyDeviceLabel('Built-in Speaker')).toBe('speaker');
  });

  it('classifies internal default as speaker', () => {
    expect(classifyDeviceLabel('Default - Internal Speakers')).toBe('speaker');
  });

  it('returns unknown for empty label', () => {
    expect(classifyDeviceLabel('')).toBe('unknown');
  });

  it('returns unknown for unrecognized labels', () => {
    expect(classifyDeviceLabel('Mystery Audio Device')).toBe('unknown');
  });
});

describe('NullAudioDeviceMonitor', () => {
  it('reports an empty snapshot', async () => {
    const m = new NullAudioDeviceMonitor();
    const snap = await m.start();
    expect(snap).toEqual({ devices: [], active: null, hasEarphone: false });
    expect(m.current()).toEqual(snap);
  });

  it('on() returns a no-op unsubscribe', () => {
    const m = new NullAudioDeviceMonitor();
    const off = m.on(() => {});
    expect(typeof off).toBe('function');
    off();
  });

  it('stop() is idempotent', () => {
    const m = new NullAudioDeviceMonitor();
    m.stop();
    m.stop();
  });
});

describe('WebAudioDeviceMonitor', () => {
  type FakeDevice = Partial<MediaDeviceInfo> & {
    kind: MediaDeviceInfo['kind'];
    deviceId: string;
    groupId: string;
    label: string;
  };

  function setup(initial: FakeDevice[]) {
    const handlers: Array<() => void> = [];
    let current = initial;
    const md = {
      enumerateDevices: jest.fn(async () => current as MediaDeviceInfo[]),
      addEventListener: jest.fn((_t: string, h: () => void) => handlers.push(h)),
      removeEventListener: jest.fn((_t: string, h: () => void) => {
        const idx = handlers.indexOf(h);
        if (idx >= 0) handlers.splice(idx, 1);
      }),
    };
    (globalThis as unknown as { navigator: { mediaDevices: typeof md } }).navigator = {
      mediaDevices: md,
    };
    return {
      md,
      setDevices: (next: FakeDevice[]) => {
        current = next;
        for (const h of [...handlers]) h();
      },
    };
  }

  afterEach(() => {
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
  });

  it('returns empty snapshot when navigator.mediaDevices is missing', async () => {
    const m = new WebAudioDeviceMonitor();
    const snap = await m.start();
    expect(snap).toEqual({ devices: [], active: null, hasEarphone: false });
  });

  it('lists audio outputs and picks the bluetooth device as active', async () => {
    setup([
      {
        kind: 'audiooutput',
        deviceId: 'spk-1',
        groupId: 'g1',
        label: 'Built-in Speaker',
      },
      { kind: 'audiooutput', deviceId: 'bt-1', groupId: 'g2', label: 'AirPods Pro' },
    ]);
    const m = new WebAudioDeviceMonitor();
    const snap = await m.start();
    expect(snap.devices).toHaveLength(2);
    expect(snap.active?.kind).toBe('bluetooth');
    expect(snap.active?.label).toBe('AirPods Pro');
    expect(snap.hasEarphone).toBe(true);
  });

  it('falls back to audioinput when audiooutput is empty (Safari)', async () => {
    setup([
      {
        kind: 'audioinput',
        deviceId: 'mic-1',
        groupId: 'g1',
        label: 'AirPods Pro Microphone',
      },
    ]);
    const m = new WebAudioDeviceMonitor();
    const snap = await m.start();
    expect(snap.devices).toHaveLength(1);
    expect(snap.active?.kind).toBe('bluetooth');
  });

  it('emits a snapshot when devicechange fires', async () => {
    const ctl = setup([
      { kind: 'audiooutput', deviceId: 's', groupId: 'g', label: 'Built-in Speaker' },
    ]);
    const m = new WebAudioDeviceMonitor();
    const snapshots: AudioDeviceSnapshot[] = [];
    m.on((s) => snapshots.push(s));
    await m.start();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.hasEarphone).toBe(false);
    ctl.setDevices([
      { kind: 'audiooutput', deviceId: 's', groupId: 'g', label: 'Built-in Speaker' },
      { kind: 'audiooutput', deviceId: 'b', groupId: 'g2', label: 'Sony WF-1000XM5' },
    ]);
    // wait for the async refresh to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[snapshots.length - 1]?.hasEarphone).toBe(true);
    expect(snapshots[snapshots.length - 1]?.active?.kind).toBe('bluetooth');
  });

  it('stop() removes the devicechange listener', async () => {
    const ctl = setup([
      { kind: 'audiooutput', deviceId: 's', groupId: 'g', label: 'Built-in Speaker' },
    ]);
    const m = new WebAudioDeviceMonitor();
    await m.start();
    m.stop();
    expect(ctl.md.removeEventListener).toHaveBeenCalled();
  });

  it('returns empty snapshot when enumerateDevices throws', async () => {
    (globalThis as unknown as { navigator: unknown }).navigator = {
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error('denied');
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    };
    const m = new WebAudioDeviceMonitor();
    const snap = await m.start();
    expect(snap).toEqual({ devices: [], active: null, hasEarphone: false });
  });
});
