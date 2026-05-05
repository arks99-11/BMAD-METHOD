/**
 * Story 5.3 — Turn log unit tests.
 */

import { TurnLog, makeTurnId, resetTurnIdSequence } from './turn-log';

beforeEach(() => {
  resetTurnIdSequence();
});

describe('TurnLog', () => {
  it('opens a turn with empty source/target', () => {
    const log = new TurnLog();
    const turn = log.openTurn('en-US', 'es-ES', 100);
    expect(turn.id).toBe('turn-1');
    expect(turn.source).toEqual({ text: '', lang: 'en-US', isFinal: false });
    expect(turn.target).toEqual({ text: '', lang: 'es-ES', isFinal: false });
    expect(turn.startedAt).toBe(100);
    expect(log.size()).toBe(1);
  });

  it('updates source partial without flipping isFinal', () => {
    const log = new TurnLog();
    const turn = log.openTurn('en', 'es', 0);
    const updated = log.updateSourcePartial(turn.id, 'hello');
    expect(updated?.source.text).toBe('hello');
    expect(updated?.source.isFinal).toBe(false);
  });

  it('commits source final and flips isFinal', () => {
    const log = new TurnLog();
    const turn = log.openTurn('en', 'es', 0);
    log.updateSourcePartial(turn.id, 'hel');
    const updated = log.commitSourceFinal(turn.id, 'hello world');
    expect(updated?.source.text).toBe('hello world');
    expect(updated?.source.isFinal).toBe(true);
  });

  it('updates target partial', () => {
    const log = new TurnLog();
    const turn = log.openTurn('en', 'es', 0);
    const updated = log.updateTargetPartial(turn.id, 'hola');
    expect(updated?.target.text).toBe('hola');
    expect(updated?.target.isFinal).toBe(false);
  });

  it('commits target final and stamps completedAt', () => {
    const log = new TurnLog();
    const turn = log.openTurn('en', 'es', 0);
    const updated = log.commitTargetFinal(turn.id, 'hola mundo', 250);
    expect(updated?.target.text).toBe('hola mundo');
    expect(updated?.target.isFinal).toBe(true);
    expect(updated?.completedAt).toBe(250);
  });

  it('updates source language post language-detected', () => {
    const log = new TurnLog();
    const turn = log.openTurn('auto', 'es', 0);
    const updated = log.updateSourceLang(turn.id, 'fr-FR');
    expect(updated?.source.lang).toBe('fr-FR');
  });

  it('returns undefined for unknown ids', () => {
    const log = new TurnLog();
    expect(log.updateSourcePartial('does-not-exist', 'x')).toBeUndefined();
    expect(log.commitTargetFinal('does-not-exist', 'x', 0)).toBeUndefined();
    expect(log.get('does-not-exist')).toBeUndefined();
  });

  it('openTurnOrUndefined returns the most recent open turn', () => {
    const log = new TurnLog();
    const t1 = log.openTurn('en', 'es', 0);
    const t2 = log.openTurn('en', 'es', 100);
    log.commitTargetFinal(t1.id, 'done', 200);
    expect(log.openTurnOrUndefined()?.id).toBe(t2.id);
    log.commitTargetFinal(t2.id, 'done', 300);
    expect(log.openTurnOrUndefined()).toBeUndefined();
  });

  it('list returns all turns in order', () => {
    const log = new TurnLog();
    log.openTurn('en', 'es', 0);
    log.openTurn('en', 'es', 100);
    log.openTurn('en', 'es', 200);
    expect(log.list()).toHaveLength(3);
    expect(log.list()[0]!.startedAt).toBe(0);
    expect(log.list()[2]!.startedAt).toBe(200);
  });

  it('clear empties the log', () => {
    const log = new TurnLog();
    log.openTurn('en', 'es', 0);
    log.openTurn('en', 'es', 100);
    log.clear();
    expect(log.size()).toBe(0);
    expect(log.list()).toEqual([]);
  });
});

describe('makeTurnId', () => {
  it('produces sequential ids', () => {
    expect(makeTurnId()).toBe('turn-1');
    expect(makeTurnId()).toBe('turn-2');
    expect(makeTurnId()).toBe('turn-3');
  });

  it('resetTurnIdSequence restarts numbering', () => {
    makeTurnId();
    makeTurnId();
    resetTurnIdSequence();
    expect(makeTurnId()).toBe('turn-1');
  });
});
