/**
 * Story 8.4 — Language pack manager.
 *
 * State machine that wraps a `PackDownloader` and a `LocalStore`:
 *
 *   not-installed -> queued -> downloading -> verifying -> installing
 *   -> installed
 *
 * Failures send the status to 'failed' with an error code; the UI
 * may retry. Cancellation transitions back to 'not-installed' (or
 * 'installed' if a previous version is still on disk).
 *
 * The manager is single-flight per pack id: a second `install()` for
 * an in-flight pack returns the existing promise.
 */

import type { LocalStore } from '../store/store-types';
import type {
  PackDownloader,
  PackInstallStatus,
  PackManifest,
} from './pack-types';

export type PackManagerListener = (status: PackInstallStatus) => void;

export interface PackManagerOptions {
  store: LocalStore;
  downloader: PackDownloader;
}

interface InFlight {
  controller: AbortController;
  promise: Promise<PackInstallStatus>;
}

export class PackManager {
  private readonly store: LocalStore;
  private readonly downloader: PackDownloader;
  private readonly statuses = new Map<string, PackInstallStatus>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly listeners = new Set<PackManagerListener>();

  constructor(opts: PackManagerOptions) {
    this.store = opts.store;
    this.downloader = opts.downloader;
  }

  /** Hydrate installed-pack state from the store. */
  async load(): Promise<void> {
    const rows = await this.store.listLanguagePacks();
    for (const row of rows) {
      this.setStatus({
        manifestId: row.id,
        state: 'installed',
        installedVersion: row.version,
      });
    }
  }

  on(listener: PackManagerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  status(manifestId: string): PackInstallStatus {
    return (
      this.statuses.get(manifestId) ?? {
        manifestId,
        state: 'not-installed',
      }
    );
  }

  list(): PackInstallStatus[] {
    return [...this.statuses.values()].map((s) => ({ ...s }));
  }

  /**
   * Begin / resume install for a manifest. Single-flight: a second
   * call while in-progress returns the same promise.
   */
  install(manifest: PackManifest): Promise<PackInstallStatus> {
    const existing = this.inFlight.get(manifest.id);
    if (existing !== undefined) return existing.promise;

    const controller = new AbortController();
    const promise = this.runInstall(manifest, controller.signal).finally(() => {
      this.inFlight.delete(manifest.id);
    });
    this.inFlight.set(manifest.id, { controller, promise });
    return promise;
  }

  /** Cancel an in-flight install. Resolves once teardown completes. */
  async cancel(manifestId: string): Promise<void> {
    const f = this.inFlight.get(manifestId);
    if (f === undefined) return;
    f.controller.abort();
    try {
      await f.promise;
    } catch {
      // ignore — promise is awaited only for teardown
    }
  }

  async uninstall(manifestId: string): Promise<void> {
    const status = this.statuses.get(manifestId);
    if (status === undefined) return;
    if (status.state !== 'installed' || status.installedPath === undefined) {
      this.setStatus({ manifestId, state: 'not-installed' });
      return;
    }
    await this.downloader.uninstall(status.installedPath);
    await this.store.removeLanguagePack(manifestId);
    this.setStatus({ manifestId, state: 'not-installed' });
  }

  private async runInstall(
    manifest: PackManifest,
    signal: AbortSignal,
  ): Promise<PackInstallStatus> {
    this.setStatus({ manifestId: manifest.id, state: 'queued', progress: 0 });
    try {
      this.setStatus({ manifestId: manifest.id, state: 'downloading', progress: 0 });
      const { path } = await this.downloader.download(
        manifest,
        (received, total): void => {
          if (total > 0) {
            this.setStatus({
              manifestId: manifest.id,
              state: 'downloading',
              progress: Math.min(1, received / total),
            });
          }
        },
        signal,
      );
      if (signal.aborted) throw makeError('network', 'aborted');

      this.setStatus({ manifestId: manifest.id, state: 'verifying', progress: 1 });
      const ok = await this.downloader.verify(path, manifest.sha256);
      if (!ok) throw makeError('integrity', 'sha256 mismatch');

      this.setStatus({ manifestId: manifest.id, state: 'installing' });
      const { installedPath } = await this.downloader.install(path, manifest);

      await this.store.upsertLanguagePack({
        id: manifest.id,
        lang: manifest.lang,
        version: manifest.version,
        sizeBytes: manifest.sizeBytes,
        downloadedAt: Date.now(),
      });

      const next: PackInstallStatus = {
        manifestId: manifest.id,
        state: 'installed',
        installedPath,
        installedVersion: manifest.version,
      };
      this.setStatus(next);
      return next;
    } catch (err) {
      const status = toFailedStatus(manifest.id, err);
      this.setStatus(status);
      return status;
    }
  }

  private setStatus(status: PackInstallStatus): void {
    this.statuses.set(status.manifestId, status);
    for (const l of this.listeners) l({ ...status });
  }
}

function makeError(
  code: PackInstallStatus['errorCode'],
  message: string,
): Error & { code: PackInstallStatus['errorCode'] } {
  const err = new Error(message) as Error & { code: PackInstallStatus['errorCode'] };
  err.code = code;
  return err;
}

function toFailedStatus(
  manifestId: string,
  err: unknown,
): PackInstallStatus {
  const e = err as { code?: PackInstallStatus['errorCode']; message?: string };
  return {
    manifestId,
    state: 'failed',
    errorCode: e.code ?? 'unknown',
    errorMessage: e.message ?? 'unknown',
  };
}
