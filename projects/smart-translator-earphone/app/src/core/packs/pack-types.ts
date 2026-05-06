/**
 * Story 8.4 — Language pack manifest and downloader contracts.
 *
 * Language packs are zipped bundles of on-device STT (Whisper) /
 * MT (NLLB) weights served from R2 and cached on device. The
 * manifest is fetched from the server plane (Epic 11) and cached
 * locally; the downloader streams the .zip with progress, verifies
 * the SHA-256, and registers the unpacked path with the on-device
 * adapters.
 *
 * This module ships the JS-side contracts and the manager state
 * machine. The actual native unzip + filesystem work lives in the
 * RN shell.
 */

import type { LangCode } from '../audio/audio-session-types';

export interface PackManifest {
  /** Stable id, e.g. 'whisper-small-en'. */
  id: string;
  lang: LangCode;
  /** Engine label this pack feeds, e.g. 'whisper-on-device'. */
  engine: string;
  version: string;
  sizeBytes: number;
  /** SHA-256 of the .zip contents, lowercase hex. */
  sha256: string;
  /** Public R2 URL of the .zip. */
  url: string;
}

export type PackInstallState =
  | 'not-installed'
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'installed'
  | 'failed';

export interface PackInstallStatus {
  manifestId: string;
  state: PackInstallState;
  /** 0..1 download progress; only meaningful during 'downloading'. */
  progress?: number;
  /** Last error code if state is 'failed'. */
  errorCode?: 'network' | 'integrity' | 'unzip' | 'storage' | 'unknown';
  /** Last error message if state is 'failed'. */
  errorMessage?: string;
  /** Filesystem path of the unpacked pack, when 'installed'. */
  installedPath?: string;
  /** Local installed version (matches manifest.version). */
  installedVersion?: string;
}

export interface PackDownloader {
  /**
   * Stream the .zip and report progress. Resolves with the local
   * file path on disk (the manager then unpacks).
   */
  download(
    manifest: PackManifest,
    onProgress: (received: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<{ path: string }>;
  /**
   * Verify the downloaded .zip against the manifest's SHA-256.
   */
  verify(zipPath: string, expectedSha256: string): Promise<boolean>;
  /**
   * Unzip the verified bundle to a destination folder owned by the
   * pack manager. Returns the final installed path.
   */
  install(zipPath: string, manifest: PackManifest): Promise<{ installedPath: string }>;
  /** Remove a previously-installed pack from disk. */
  uninstall(installedPath: string): Promise<void>;
}
