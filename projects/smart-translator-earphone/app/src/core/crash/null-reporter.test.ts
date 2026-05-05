import { NullCrashReporter } from './null-reporter';

describe('NullCrashReporter', () => {
  it('all methods are no-ops and do not throw', () => {
    const r = new NullCrashReporter();
    r.addBreadcrumb({ category: 'a', message: 'b', ts: 0 });
    r.captureException(new Error('x'));
    r.captureFatal(new Error('y'));
    r.setInstallId('id-1');
    r.setInstallId(undefined);
  });
});
