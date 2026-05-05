/**
 * Story 8.1 — ConnectivityTracker tests.
 */

import {
  ConnectivityTracker,
  type ConnectivityProbe,
  type ConnectivityState,
} from './connectivity-tracker';

class FakeProbe implements ConnectivityProbe {
  private listener: ((s: Omit<ConnectivityState, 'ts'>) => void) | null = null;
  private snapshot: Omit<ConnectivityState, 'ts'> = { online: false, metered: false };

  setSnapshot(s: Omit<ConnectivityState, 'ts'>): void {
    this.snapshot = s;
  }

  push(s: Omit<ConnectivityState, 'ts'>): void {
    this.snapshot = s;
    this.listener?.(s);
  }

  async read(): Promise<Omit<ConnectivityState, 'ts'>> {
    return this.snapshot;
  }

  on(listener: (s: Omit<ConnectivityState, 'ts'>) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
}

describe('ConnectivityTracker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('start() seeds the initial snapshot', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: false, type: 'wifi' });
    const tracker = new ConnectivityTracker({ probe });
    const initial = await tracker.start();
    expect(initial.online).toBe(true);
    expect(initial.metered).toBe(false);
    expect(initial.type).toBe('wifi');
  });

  it('debounces flicker into a single emission', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: false });
    const tracker = new ConnectivityTracker({ probe, debounceMs: 100 });
    await tracker.start();

    const captured: ConnectivityState[] = [];
    tracker.on((s) => captured.push(s));

    probe.push({ online: false, metered: false });
    probe.push({ online: true, metered: false });
    probe.push({ online: false, metered: false });

    jest.advanceTimersByTime(100);
    await Promise.resolve();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.online).toBe(false);
  });

  it('emits separate notifications for stable transitions', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: false });
    const tracker = new ConnectivityTracker({ probe, debounceMs: 50 });
    await tracker.start();

    const captured: ConnectivityState[] = [];
    tracker.on((s) => captured.push(s));

    probe.push({ online: false, metered: false });
    jest.advanceTimersByTime(50);
    probe.push({ online: true, metered: true, type: 'cellular' });
    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured.at(-1)!.online).toBe(true);
    expect(captured.at(-1)!.metered).toBe(true);
  });

  it('setCloudOff(true) forces online=false and metered=false', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: true, type: 'cellular' });
    const tracker = new ConnectivityTracker({ probe });
    await tracker.start();
    tracker.setCloudOff(true);
    expect(tracker.current().online).toBe(false);
    expect(tracker.current().metered).toBe(false);
  });

  it('setCloudOff(false) restores the underlying probe state', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: false, type: 'wifi' });
    const tracker = new ConnectivityTracker({ probe });
    await tracker.start();
    tracker.setCloudOff(true);
    tracker.setCloudOff(false);
    expect(tracker.current().online).toBe(true);
    expect(tracker.current().type).toBe('wifi');
  });

  it('setCloudOff is idempotent', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: false });
    const tracker = new ConnectivityTracker({ probe });
    await tracker.start();
    const captured: ConnectivityState[] = [];
    tracker.on((s) => captured.push(s));
    tracker.setCloudOff(false); // already false
    tracker.setCloudOff(false);
    expect(captured).toHaveLength(0);
  });

  it('stop() detaches and prevents further emissions', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: false });
    const tracker = new ConnectivityTracker({ probe, debounceMs: 50 });
    await tracker.start();
    const captured: ConnectivityState[] = [];
    tracker.on((s) => captured.push(s));
    tracker.stop();
    probe.push({ online: false, metered: false });
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(captured).toHaveLength(0);
  });

  it('on() returns an unsubscribe function', async () => {
    const probe = new FakeProbe();
    probe.setSnapshot({ online: true, metered: false });
    const tracker = new ConnectivityTracker({ probe, debounceMs: 50 });
    await tracker.start();
    let count = 0;
    const off = tracker.on(() => {
      count += 1;
    });
    probe.push({ online: false, metered: false });
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    off();
    probe.push({ online: true, metered: false });
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(count).toBe(1);
  });
});
