/**
 * Story 6.2 / 6.3 — Lecture view-model tests.
 */

import type { TurnPair } from '../session/session-types';
import { LectureViewModel } from './lecture-viewmodel';

function makeTurn(id: string, src: string, tgt: string, finalised: boolean = true): TurnPair {
  return {
    id,
    source: { text: src, lang: 'EN', isFinal: finalised },
    target: { text: tgt, lang: 'ES', isFinal: finalised },
    startedAt: 0,
    ...(finalised ? { completedAt: 1 } : {}),
  };
}

describe('LectureViewModel', () => {
  it('starts in live mode with no turns', () => {
    const vm = new LectureViewModel();
    expect(vm.state()).toEqual({ turns: [], isLive: true });
  });

  it('exposes the latest turn list', () => {
    const vm = new LectureViewModel();
    vm.setTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    expect(vm.state().turns).toHaveLength(2);
    expect(vm.state().turns[1]!.id).toBe('b');
  });

  it('anchorOn sets anchor and exits live mode', () => {
    const vm = new LectureViewModel();
    vm.setTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    vm.anchorOn('a');
    expect(vm.state().isLive).toBe(false);
    expect(vm.state().anchorTurnId).toBe('a');
  });

  it('anchorOn for unknown id is a no-op', () => {
    const vm = new LectureViewModel();
    vm.setTurns([makeTurn('a', 'hi', 'hola')]);
    vm.anchorOn('does-not-exist');
    expect(vm.state().isLive).toBe(true);
    expect(vm.state().anchorTurnId).toBeUndefined();
  });

  it('goLive returns to tailing and clears anchor', () => {
    const vm = new LectureViewModel();
    vm.setTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    vm.anchorOn('a');
    vm.goLive();
    expect(vm.state().isLive).toBe(true);
    expect(vm.state().anchorTurnId).toBeUndefined();
  });

  it('clears anchor on setTurns when live', () => {
    const vm = new LectureViewModel();
    vm.setTurns([makeTurn('a', 'hi', 'hola')]);
    expect(vm.state().anchorTurnId).toBeUndefined();
    vm.setTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    expect(vm.state().anchorTurnId).toBeUndefined();
    expect(vm.state().isLive).toBe(true);
  });

  it('keeps anchor on setTurns when scrolled back', () => {
    const vm = new LectureViewModel();
    vm.setTurns([makeTurn('a', 'hi', 'hola')]);
    vm.anchorOn('a');
    vm.setTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    expect(vm.state().isLive).toBe(false);
    expect(vm.state().anchorTurnId).toBe('a');
  });

  it('emits state to subscribers on every mutation', () => {
    const vm = new LectureViewModel();
    const captured: number[] = [];
    vm.on((s) => captured.push(s.turns.length));
    vm.setTurns([makeTurn('a', 'hi', 'hola')]);
    vm.setTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    vm.anchorOn('a');
    vm.goLive();
    expect(captured.length).toBe(4);
    expect(captured[0]).toBe(1);
    expect(captured[1]).toBe(2);
  });

  it('on() returns an unsubscribe function', () => {
    const vm = new LectureViewModel();
    let count = 0;
    const off = vm.on(() => {
      count += 1;
    });
    vm.setTurns([makeTurn('a', 'hi', 'hola')]);
    off();
    vm.setTurns([makeTurn('a', 'hi', 'hola'), makeTurn('b', 'bye', 'adios')]);
    expect(count).toBe(1);
  });
});
