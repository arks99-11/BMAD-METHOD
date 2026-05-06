/**
 * Story 6.4 — Lecture export tests.
 */

import type { TurnPair } from '../session/session-types';
import { exportLecture } from './lecture-export';

function makeTurn(id: string, src: string, tgt: string, finalised: boolean = true): TurnPair {
  return {
    id,
    source: { text: src, lang: 'EN', isFinal: finalised },
    target: { text: tgt, lang: 'ES', isFinal: finalised },
    startedAt: 0,
    ...(finalised ? { completedAt: 1 } : {}),
  };
}

describe('exportLecture (txt)', () => {
  it('produces a plain dialogue list', () => {
    const out = exportLecture(
      [makeTurn('a', 'hello', 'hola'), makeTurn('b', 'bye', 'adios')],
      'txt',
    );
    expect(out).toContain('hello');
    expect(out).toContain('hola');
    expect(out).toContain('bye');
    expect(out).toContain('adios');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('marks partial turns with [partial]', () => {
    const out = exportLecture([makeTurn('a', 'hel', 'ho', false)], 'txt');
    expect(out).toContain('hel [partial]');
    expect(out).toContain('ho [partial]');
  });

  it('drops partial turns when finalOnly is true', () => {
    const out = exportLecture(
      [makeTurn('a', 'good', 'bueno'), makeTurn('b', 'bad', 'malo', false)],
      'txt',
      { finalOnly: true },
    );
    expect(out).toContain('good');
    expect(out).not.toContain('bad');
  });

  it('prepends the title when given', () => {
    const out = exportLecture([makeTurn('a', 'hi', 'hola')], 'txt', { title: 'Lecture Q1' });
    expect(out.startsWith('Lecture Q1')).toBe(true);
  });
});

describe('exportLecture (md)', () => {
  it('emits Markdown with bold language codes', () => {
    const out = exportLecture([makeTurn('a', 'hello', 'hola')], 'md');
    expect(out).toContain('**EN:** hello');
    expect(out).toContain('**ES:** hola');
  });

  it('separates turns with horizontal rules', () => {
    const out = exportLecture(
      [makeTurn('a', 'one', 'uno'), makeTurn('b', 'two', 'dos')],
      'md',
    );
    expect(out).toContain('\n---\n');
  });

  it('renders the title as an H1', () => {
    const out = exportLecture([makeTurn('a', 'hi', 'hola')], 'md', { title: 'Class' });
    expect(out.startsWith('# Class')).toBe(true);
  });

  it('escapes Markdown control characters in transcript text', () => {
    const out = exportLecture([makeTurn('a', '*important* `code`', 'foo')], 'md');
    expect(out).toContain('\\*important\\*');
    expect(out).toContain('\\`code\\`');
  });

  it('marks partial turns with italic (partial)', () => {
    const out = exportLecture([makeTurn('a', 'hi', 'ho', false)], 'md');
    expect(out).toContain('_(partial)_');
  });
});
