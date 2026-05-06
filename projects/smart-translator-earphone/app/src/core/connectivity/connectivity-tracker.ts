/**
 * Story 8.1 — Connectivity-aware mode switcher.
 *
 * Wraps the platform's connectivity probe (RN: `@react-native-community/netinfo`;
 * iOS: `NWPathMonitor`; Android: `ConnectivityManager`) into a stable,
 * cross-platform observable. Consumers (engine router, session
 * controller, settings UI banner) subscribe via `on(listener)` and
 * read `current()` for the latest snapshot.
 *
 * The tracker:
 *  - Coalesces flicker (fewer than `debounceMs` between transitions
 *    is treated as a single change).
 *  - Distinguishes between "online" (cellular / wifi reachable) and
 *    "metered" (cellular). Pro-tier users may want to suppress
 *    streaming voice synthesis on metered connections (Story 10.x).
 *  - Surfaces a `cloudOff` override that the privacy gate can read
 *    without the user actually toggling airplane mode (Story 7.3 +
 *    project-context.md rule 8).
 */

export interface ConnectivityState {
  online: boolean;
  /** True when the network is metered (cellular). */
  metered: boolean;
  /** Connection-type label for telemetry; e.g. 'wifi', 'cellular'. */
  type?: 'wifi' | 'cellular' | 'ethernet' | 'unknown' | 'none';
  /** When this state was last updated. */
  ts: number;
}

export type ConnectivityListener = (state: ConnectivityState) => void;

export interface ConnectivityProbe {
  /** Best-effort initial snapshot. */
  read(): Promise<Omit<ConnectivityState, 'ts'>>;
  /**
   * Subscribe to native connectivity changes. Returns an unsubscribe
   * function. Implementations push raw events; the tracker debounces.
   */
  on(listener: (state: Omit<ConnectivityState, 'ts'>) => void): () => void;
}

export interface ConnectivityTrackerOptions {
  probe: ConnectivityProbe;
  /** Coalesce window in ms; default 250. */
  debounceMs?: number;
  /** Wall-clock; injectable for tests. */
  now?: () => number;
}

export class ConnectivityTracker {
  private readonly probe: ConnectivityProbe;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<ConnectivityListener>();
  private state: ConnectivityState = { online: false, metered: false, ts: 0 };
  private cloudOff = false;
  private detach: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ConnectivityTrackerOptions) {
    this.probe = opts.probe;
    this.debounceMs = opts.debounceMs ?? 250;
    this.now = opts.now ?? Date.now;
  }

  /** Read once and start listening to changes. */
  async start(): Promise<ConnectivityState> {
    const snap = await this.probe.read();
    this.state = { ...snap, ts: this.now() };
    this.detach = this.probe.on((s) => {
      this.queue(s);
    });
    this.emit();
    return this.current();
  }

  /** Stop listening and reset to disconnected. */
  stop(): void {
    if (this.detach !== null) {
      this.detach();
      this.detach = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Override the perceived online state. When `cloudOff` is true,
   * `current().online` is forced to false so the engine router and
   * other consumers fall through to the offline corridor without
   * needing to toggle the radio.
   */
  setCloudOff(cloudOff: boolean): void {
    if (this.cloudOff === cloudOff) return;
    this.cloudOff = cloudOff;
    this.emit();
  }

  current(): ConnectivityState {
    if (this.cloudOff) {
      return { ...this.state, online: false, metered: false };
    }
    return { ...this.state };
  }

  on(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private queue(snap: Omit<ConnectivityState, 'ts'>): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.state = { ...snap, ts: this.now() };
      this.emit();
    }, this.debounceMs);
  }

  private emit(): void {
    const snap = this.current();
    for (const l of this.listeners) l(snap);
  }
}
