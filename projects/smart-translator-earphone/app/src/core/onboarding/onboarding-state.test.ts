import { InMemoryStore } from '../store/in-memory-store';
import { OnboardingManager } from './onboarding-state';

async function setup(): Promise<{ mgr: OnboardingManager; store: InMemoryStore }> {
  const store = new InMemoryStore();
  await store.init();
  const mgr = new OnboardingManager(store);
  return { mgr, store };
}

describe('OnboardingManager', () => {
  it('starts at the welcome step on a fresh store', async () => {
    const { mgr } = await setup();
    await mgr.load();
    expect(mgr.state().current).toBe('welcome');
    expect(mgr.state().completed).toEqual([]);
  });

  it('advances through steps in order', async () => {
    const { mgr } = await setup();
    await mgr.load();
    await mgr.complete('welcome');
    expect(mgr.state().current).toBe('mic-permission');
    await mgr.complete('mic-permission');
    await mgr.complete('language-pair');
    expect(mgr.state().current).toBe('voice-pick');
  });

  it('isDone() returns true once all required steps are complete', async () => {
    const { mgr } = await setup();
    await mgr.load();
    for (const step of [
      'welcome',
      'mic-permission',
      'language-pair',
      'voice-pick',
      'sign-in',
    ] as const) {
      await mgr.complete(step);
    }
    expect(mgr.isDone()).toBe(true);
  });

  it('skip() is allowed for sign-in only', async () => {
    const { mgr } = await setup();
    await mgr.load();
    await mgr.skip('sign-in');
    expect(mgr.state().completed).toContain('sign-in');
    await expect(mgr.skip('mic-permission' as 'sign-in')).rejects.toThrow();
  });

  it('persists across instances backed by the same store', async () => {
    const { mgr, store } = await setup();
    await mgr.load();
    await mgr.complete('welcome');
    const mgr2 = new OnboardingManager(store);
    await mgr2.load();
    expect(mgr2.state().completed).toContain('welcome');
    expect(mgr2.state().current).toBe('mic-permission');
  });

  it('reset() returns to welcome and drops completed', async () => {
    const { mgr } = await setup();
    await mgr.load();
    await mgr.complete('welcome');
    await mgr.complete('mic-permission');
    await mgr.reset();
    expect(mgr.state().current).toBe('welcome');
    expect(mgr.state().completed).toEqual([]);
  });

  it('emits state changes to subscribers', async () => {
    const { mgr } = await setup();
    await mgr.load();
    const captured: string[] = [];
    mgr.on((s) => captured.push(s.current));
    await mgr.complete('welcome');
    await mgr.complete('mic-permission');
    expect(captured).toEqual(['mic-permission', 'language-pair']);
  });

  it('falls back to defaults on corrupt JSON', async () => {
    const { mgr, store } = await setup();
    await store.setSetting('app.onboarding', '{not json');
    await mgr.load();
    expect(mgr.state().current).toBe('welcome');
  });

  it('complete() is idempotent', async () => {
    const { mgr } = await setup();
    await mgr.load();
    await mgr.complete('welcome');
    await mgr.complete('welcome');
    expect(mgr.state().completed).toEqual(['welcome']);
  });
});
