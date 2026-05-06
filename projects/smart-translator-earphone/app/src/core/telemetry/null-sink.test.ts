import { NullTelemetrySink } from './null-sink';

describe('NullTelemetrySink', () => {
  it('capture/flush/reset are no-ops and do not throw', async () => {
    const sink = new NullTelemetrySink();
    sink.capture({ name: 'session.start', ts: 0, tags: {} });
    await sink.flush();
    sink.reset();
  });
});
