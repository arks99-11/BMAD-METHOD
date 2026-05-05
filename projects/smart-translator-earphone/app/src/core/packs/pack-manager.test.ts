/**
 * Story 8.4 — PackManager tests.
 */

import { InMemoryStore } from '../store/in-memory-store';
import { PackManager } from './pack-manager';
import type {
  PackDownloader,
  PackInstallStatus,
  PackManifest,
} from './pack-types';

const MANIFEST: PackManifest = {
  id: 'whisper-small-en',
  lang: 'EN',
  engine: 'whisper-on-device',
  version: '1.0.0',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  url: 'https://example.test/whisper-small-en.zip',
};

class FakeDownloader implements PackDownloader {
  downloadShouldFail = false;
  verifyResult = true;
  installShouldFail = false;
  capturedAbort: AbortSignal | null = null;
  delayMs = 0;
  progressUpdates: number[] = [];

  async download(
    manifest: PackManifest,
    onProgress: (received: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<{ path: string }> {
    this.capturedAbort = signal;
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    }
    onProgress(512, manifest.sizeBytes);
    this.progressUpdates.push(0.5);
    onProgress(manifest.sizeBytes, manifest.sizeBytes);
    this.progressUpdates.push(1.0);
    if (this.downloadShouldFail) {
      const err = new Error('net') as Error & { code: 'network' };
      err.code = 'network';
      throw err;
    }
    return { path: `/tmp/${manifest.id}.zip` };
  }

  async verify(_zipPath: string, _expectedSha256: string): Promise<boolean> {
    return this.verifyResult;
  }

  async install(
    _zipPath: string,
    manifest: PackManifest,
  ): Promise<{ installedPath: string }> {
    if (this.installShouldFail) {
      const err = new Error('unzip-fail') as Error & { code: 'unzip' };
      err.code = 'unzip';
      throw err;
    }
    return { installedPath: `/data/packs/${manifest.id}` };
  }

  async uninstall(_installedPath: string): Promise<void> {
    // no-op
  }
}

async function setupStore(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.init();
  return store;
}

describe('PackManager', () => {
  it('reports not-installed for unknown packs', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    const mgr = new PackManager({ store, downloader });
    expect(mgr.status('unknown').state).toBe('not-installed');
  });

  it('install() walks queued -> downloading -> verifying -> installing -> installed', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    const mgr = new PackManager({ store, downloader });
    const seen: string[] = [];
    mgr.on((s) => seen.push(s.state));

    const final = await mgr.install(MANIFEST);
    expect(final.state).toBe('installed');
    expect(final.installedPath).toBe(`/data/packs/${MANIFEST.id}`);
    expect(seen).toEqual([
      'queued',
      'downloading',
      'downloading',
      'downloading',
      'verifying',
      'installing',
      'installed',
    ]);
  });

  it('persists installed packs to the store', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    const mgr = new PackManager({ store, downloader });
    await mgr.install(MANIFEST);
    const rows = await store.listLanguagePacks();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(MANIFEST.id);
    expect(rows[0]!.version).toBe(MANIFEST.version);
  });

  it('reports failed status with error code on download failure', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    downloader.downloadShouldFail = true;
    const mgr = new PackManager({ store, downloader });
    const final = await mgr.install(MANIFEST);
    expect(final.state).toBe('failed');
    expect(final.errorCode).toBe('network');
  });

  it('reports failed status with integrity error on bad sha256', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    downloader.verifyResult = false;
    const mgr = new PackManager({ store, downloader });
    const final = await mgr.install(MANIFEST);
    expect(final.state).toBe('failed');
    expect(final.errorCode).toBe('integrity');
  });

  it('reports failed status with unzip error on install failure', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    downloader.installShouldFail = true;
    const mgr = new PackManager({ store, downloader });
    const final = await mgr.install(MANIFEST);
    expect(final.state).toBe('failed');
    expect(final.errorCode).toBe('unzip');
  });

  it('install() is single-flight per pack id', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    downloader.delayMs = 30;
    const mgr = new PackManager({ store, downloader });
    const a = mgr.install(MANIFEST);
    const b = mgr.install(MANIFEST);
    expect(a).toBe(b);
    await a;
  });

  it('cancel() aborts an in-flight download', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    downloader.delayMs = 100;
    const mgr = new PackManager({ store, downloader });
    const promise = mgr.install(MANIFEST);
    await mgr.cancel(MANIFEST.id);
    const final = await promise;
    expect(final.state).toBe('failed');
    expect(downloader.capturedAbort?.aborted).toBe(true);
  });

  it('uninstall() drops the pack from the store and the status', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    const mgr = new PackManager({ store, downloader });
    await mgr.install(MANIFEST);
    await mgr.uninstall(MANIFEST.id);
    expect(mgr.status(MANIFEST.id).state).toBe('not-installed');
    expect(await store.listLanguagePacks()).toHaveLength(0);
  });

  it('load() rehydrates installed status from the store', async () => {
    const store = await setupStore();
    await store.upsertLanguagePack({
      id: MANIFEST.id,
      lang: MANIFEST.lang,
      version: MANIFEST.version,
      sizeBytes: MANIFEST.sizeBytes,
      downloadedAt: 0,
    });
    const downloader = new FakeDownloader();
    const mgr = new PackManager({ store, downloader });
    await mgr.load();
    const status: PackInstallStatus = mgr.status(MANIFEST.id);
    expect(status.state).toBe('installed');
    expect(status.installedVersion).toBe(MANIFEST.version);
  });

  it('list() returns all known statuses', async () => {
    const store = await setupStore();
    const downloader = new FakeDownloader();
    const mgr = new PackManager({ store, downloader });
    await mgr.install(MANIFEST);
    await mgr.install({ ...MANIFEST, id: 'another' });
    expect(mgr.list()).toHaveLength(2);
  });
});
