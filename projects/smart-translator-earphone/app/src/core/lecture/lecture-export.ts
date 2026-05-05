/**
 * Story 6.4 — Lecture session export.
 *
 * Renders a list of `TurnPair`s into a plain-text or Markdown
 * transcript. The native share-sheet (Stories 6.4 / 7.x) feeds the
 * resulting string to the OS share UI; this module is the pure-TS
 * formatter.
 *
 * Both formats include source and target text. Markdown adds language
 * codes as bold prefixes and uses a horizontal rule between turns so
 * the transcript reads cleanly when pasted into chat apps.
 */

import type { TurnPair } from '../session/session-types';

export type LectureExportFormat = 'txt' | 'md';

export interface LectureExportOptions {
  /**
   * Optional session title. Rendered as a header in MD; first line
   * in TXT.
   */
  title?: string;
  /**
   * If true, only finalised turns are included. If false (default), the
   * latest unfinalised turn is also included with `[partial]` markers.
   */
  finalOnly?: boolean;
}

export function exportLecture(
  turns: readonly TurnPair[],
  format: LectureExportFormat,
  opts: LectureExportOptions = {},
): string {
  const finalOnly = opts.finalOnly ?? false;
  const filtered = finalOnly
    ? turns.filter((t) => t.source.isFinal && t.target.isFinal)
    : [...turns];
  if (format === 'md') return formatMd(filtered, opts.title);
  return formatTxt(filtered, opts.title);
}

function formatTxt(turns: readonly TurnPair[], title?: string): string {
  const lines: string[] = [];
  if (title !== undefined && title.length > 0) {
    lines.push(title, '');
  }
  for (const turn of turns) {
    const src = turn.source.text + (turn.source.isFinal ? '' : ' [partial]');
    const tgt = turn.target.text + (turn.target.isFinal ? '' : ' [partial]');
    lines.push(src);
    lines.push(tgt);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function formatMd(turns: readonly TurnPair[], title?: string): string {
  const lines: string[] = [];
  if (title !== undefined && title.length > 0) {
    lines.push(`# ${title}`, '');
  }
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i]!;
    const srcMark = turn.source.isFinal ? '' : ' _(partial)_';
    const tgtMark = turn.target.isFinal ? '' : ' _(partial)_';
    lines.push(`**${turn.source.lang}:** ${escapeMd(turn.source.text)}${srcMark}`, '');
    lines.push(`**${turn.target.lang}:** ${escapeMd(turn.target.text)}${tgtMark}`);
    if (i < turns.length - 1) {
      lines.push('', '---', '');
    }
  }
  return lines.join('\n') + '\n';
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
}
