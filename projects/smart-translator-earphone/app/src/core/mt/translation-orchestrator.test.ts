/**
 * Story 3.5 — Translation pre-emption tests.
 *
 * Uses a controllable fake `MtProvider` that exposes start/finish/fail
 * hooks per call so tests can sequence pre-emption deterministically.
 */

import { wrapAsStream } from './base-mt-provider';
import {
  MtError,
  type MtProvider,
  type MtRequest,
  type MtResult,
  type MtStream,
} from './mt-types';
import {
  TranslationOrchestrator,
  type OrchestratorEvent,
} from './translation-orchestrator';

class ControllableProvider implements MtProvider {
  readonly engine = 'mock' as const;
  readonly calls: Array<{
    req: MtRequest;
    resolve: (r: MtResult) => void;
    reject: (e: MtError) => void;
    aborted: boolean;
  }> = [];



  translate(req: MtRequest): Promise<MtResult> {
    return this.translateStream(req).done;
  }

  translateStream(req: MtRequest): MtStream {
    const entry: {
      req: MtRequest;
      resolve: (r: MtResult) => void;
      reject: (e: MtError) => void;
      aborted: boolean;
    } = {
      req,
      resolve: () => undefined,
      reject: () => undefined,
      aborted: false,
    };
    const promise = new Promise<MtResult>((res, rej) => {
      entry.resolve = res;
      entry.reject = rej;
    });
    if (req.signal !== undefined) {
      req.signal.addEventListener('abort', () => {
        entry.aborted = true;
        entry.reject(new MtError('cancelled', 'mock', 'aborted'));
      });
    }
    this.calls.push(entry);
    return wrapAsStream('mock', promise);
  }

  finish(idx: number, text: string): void {
    this.calls[idx]?.resolve({ text, engine: 'mock', durationMs: 1 });
  }
}

function buildReq(text: string): MtRequest {
  return { text, source: 'EN', target: 'DE' };
}

describe('Story 3.5 — TranslationOrchestrator', () => {
  test('a debounced partial leads to a single translate call', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 10 });
    const events: OrchestratorEvent[] = [];
    orch.on((ev) => events.push(ev));

    orch.submitPartial(buildReq('Hello'));
    orch.submitPartial(buildReq('Hello there'));
    orch.submitPartial(buildReq('Hello there friend'));
    await new Promise((r) => setTimeout(r, 30));
    expect(provider.calls.length).toBe(1);
    expect(provider.calls[0]!.req.text).toBe('Hello there friend');

    provider.finish(0, 'Hallo da Freund');
    await new Promise((r) => setTimeout(r, 5));
    expect(events.some((e) => e.type === 'partial')).toBe(true);
  });

  test('a newer partial pre-empts the in-flight translation', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 5 });
    const events: OrchestratorEvent[] = [];
    orch.on((ev) => events.push(ev));

    orch.submitPartial(buildReq('Hello'));
    await new Promise((r) => setTimeout(r, 10));
    expect(provider.calls.length).toBe(1);

    orch.submitPartial(buildReq('Hello again'));
    await new Promise((r) => setTimeout(r, 10));
    expect(provider.calls.length).toBe(2);
    expect(provider.calls[0]!.aborted).toBe(true);
    expect(events.some((e) => e.type === 'cancelled')).toBe(true);

    provider.finish(1, 'Hallo nochmal');
    await new Promise((r) => setTimeout(r, 5));
    const partials = events.filter((e) => e.type === 'partial');
    expect(partials.length).toBe(1);
  });

  test('a final transcript pre-empts an in-flight partial', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 5 });
    const events: OrchestratorEvent[] = [];
    orch.on((ev) => events.push(ev));

    orch.submitPartial(buildReq('Hello'));
    await new Promise((r) => setTimeout(r, 10));
    expect(provider.calls.length).toBe(1);

    orch.submitFinal(buildReq('Hello world.'));
    expect(provider.calls.length).toBe(2);
    expect(provider.calls[0]!.aborted).toBe(true);

    provider.finish(1, 'Hallo Welt.');
    await new Promise((r) => setTimeout(r, 5));
    const finals = events.filter((e) => e.type === 'final');
    expect(finals.length).toBe(1);
    expect((finals[0] as { result: { text: string } }).result.text).toBe('Hallo Welt.');
  });

  test('a final transcript flushes a pending debounced partial', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 1000 });

    orch.submitPartial(buildReq('Hello'));
    orch.submitFinal(buildReq('Hello world.'));
    expect(provider.calls.length).toBe(1);
    expect(provider.calls[0]!.req.text).toBe('Hello world.');
  });

  test('empty / whitespace-only transcripts are dropped', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 5 });
    orch.submitPartial(buildReq(''));
    orch.submitPartial(buildReq('   '));
    orch.submitFinal(buildReq(''));
    await new Promise((r) => setTimeout(r, 15));
    expect(provider.calls.length).toBe(0);
  });

  test('reset() cancels in-flight without emitting cancelled', () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 0 });
    const events: OrchestratorEvent[] = [];
    orch.on((ev) => events.push(ev));

    orch.submitFinal(buildReq('Hello'));
    expect(provider.calls.length).toBe(1);
    orch.reset();
    expect(provider.calls[0]!.aborted).toBe(true);
    expect(events.some((e) => e.type === 'cancelled')).toBe(false);
  });

  test('listener unsubscribe stops further events', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 0 });
    const events: OrchestratorEvent[] = [];
    const unsub = orch.on((ev) => events.push(ev));
    orch.submitFinal(buildReq('hi'));
    unsub();
    provider.finish(0, 'hallo');
    await new Promise((r) => setTimeout(r, 5));
    expect(events.length).toBe(0);
  });

  test('streaming chunks propagate through the orchestrator with isFinal flag', async () => {
    // Use wrapAsStream to make a single-chunk stream — exercises the
    // chunk path. Multi-chunk OpenAI streaming is covered in 3.3 tests.
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 0 });
    const events: OrchestratorEvent[] = [];
    orch.on((ev) => events.push(ev));
    orch.submitFinal(buildReq('Hello'));
    provider.finish(0, 'Hallo');
    await new Promise((r) => setTimeout(r, 5));
    const chunkEv = events.find((e) => e.type === 'chunk');
    expect(chunkEv).toBeDefined();
    expect(chunkEv).toMatchObject({ type: 'chunk', text: 'Hallo', isFinal: true });
  });

  test('non-cancellation errors propagate as error events', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 0 });
    const events: OrchestratorEvent[] = [];
    orch.on((ev) => events.push(ev));
    orch.submitFinal(buildReq('hi'));
    provider.calls[0]!.reject(new MtError('engine', 'mock', 'boom'));
    await new Promise((r) => setTimeout(r, 5));
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  test('cancelled errors from the provider do NOT emit error events', async () => {
    const provider = new ControllableProvider();
    const orch = new TranslationOrchestrator({ provider, partialDebounceMs: 0 });
    const events: OrchestratorEvent[] = [];
    orch.on((ev) => events.push(ev));
    orch.submitFinal(buildReq('hi'));
    provider.calls[0]!.reject(new MtError('cancelled', 'mock', 'aborted'));
    await new Promise((r) => setTimeout(r, 5));
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
