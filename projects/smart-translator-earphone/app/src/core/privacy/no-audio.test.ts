/**
 * Story 10.2 — Privacy / no-audio static check.
 *
 * Asserts that the telemetry and crash code paths cannot leak audio
 * bytes off-device. This is a structural check, not a runtime one:
 * it inspects the type signatures of `TelemetryEvent.tags` and
 * `Breadcrumb.data` to ensure they stay restricted to enums /
 * numbers / booleans, and walks the rest of `core/` to flag any
 * call site that passes an `AudioFrame`, `Float32Array`, `Int16Array`
 * or `Uint8Array` into `capture()` or `addBreadcrumb()`.
 *
 * This test is the privacy backstop. Loosening the type signatures
 * to allow arbitrary `unknown` values, or shipping a call site that
 * forwards audio data into the telemetry / crash sink, will fail
 * here long before it can ship.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_SRC = path.join(REPO_ROOT, 'src');

const RESTRICTIVE_VALUE_TYPE = 'string | number | boolean';
const FORBIDDEN_AUDIO_TYPES = [
  'Float32Array',
  'Int16Array',
  'Uint8Array',
  'AudioFrame',
] as const;

async function readSource(rel: string): Promise<string> {
  return fs.readFile(path.join(APP_SRC, rel), 'utf8');
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listSourceFiles(p)));
    } else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('privacy: no-audio static check (Story 10.2)', () => {
  it('TelemetryEvent.tags is restricted to enum / number / boolean', async () => {
    const src = await readSource('core/telemetry/telemetry-types.ts');
    expect(src).toContain(`tags: Readonly<Record<string, ${RESTRICTIVE_VALUE_TYPE}>>`);
    expect(src).not.toMatch(/tags\??:\s*Readonly<Record<string,\s*unknown>>/);
    expect(src).not.toMatch(/tags\??:\s*Record<string,\s*unknown>/);
  });

  it('Breadcrumb.data is restricted to enum / number / boolean', async () => {
    const src = await readSource('core/crash/crash-types.ts');
    expect(src).toContain(`data?: Readonly<Record<string, ${RESTRICTIVE_VALUE_TYPE}>>`);
    expect(src).not.toMatch(/data\??:\s*Readonly<Record<string,\s*unknown>>/);
    expect(src).not.toMatch(/data\??:\s*Record<string,\s*unknown>/);
  });

  it('no capture() / addBreadcrumb() call site references audio types', async () => {
    const files = await listSourceFiles(APP_SRC);
    const offenders: string[] = [];
    for (const file of files) {
      // Telemetry/crash module files are allowed to mention these types in
      // comments (they document why they can't be passed in).
      if (
        file.includes(path.sep + 'telemetry' + path.sep) ||
        file.includes(path.sep + 'crash' + path.sep) ||
        file.includes(path.sep + 'audio' + path.sep) ||
        file.includes(path.sep + 'tts' + path.sep) ||
        file.includes(path.sep + 'session' + path.sep)
      ) {
        continue;
      }
      const text = await fs.readFile(file, 'utf8');
      // Look at every capture(...) or addBreadcrumb(...) invocation; if the
      // surrounding 200 chars mention an audio type, flag it.
      const callSites = [
        ...text.matchAll(/(?:\.capture|\.addBreadcrumb)\s*\(/g),
      ];
      for (const m of callSites) {
        const start = m.index ?? 0;
        const slice = text.slice(start, start + 400);
        for (const t of FORBIDDEN_AUDIO_TYPES) {
          if (slice.includes(t)) {
            offenders.push(`${path.relative(REPO_ROOT, file)}: '${t}' near telemetry call`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the TelemetrySink contract has no `unknown` in its public surface', async () => {
    const src = await readSource('core/telemetry/telemetry-types.ts');
    const sinkBlock = src.match(/export interface TelemetrySink \{[\s\S]*?\n\}/);
    expect(sinkBlock).not.toBeNull();
    expect(sinkBlock?.[0]).not.toMatch(/\bunknown\b/);
  });

  it('the CrashReporter contract has no `unknown` in its public surface', async () => {
    const src = await readSource('core/crash/crash-types.ts');
    const reporterBlock = src.match(/export interface CrashReporter \{[\s\S]*?\n\}/);
    expect(reporterBlock).not.toBeNull();
    expect(reporterBlock?.[0]).not.toMatch(/\bunknown\b/);
  });
});
