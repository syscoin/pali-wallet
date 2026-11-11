import type { PreferencePort } from './securityPreferences.ts';

export const HIDDEN_BALANCE = '••••';
export type BalancePrivacySnapshot = Readonly<{
  status: 'loading' | 'ready' | 'saving' | 'unavailable';
  hidden: boolean;
}>;

/** Display-only preference. Unknown persistence never exposes previously hidden amounts. */
export function createBalancePrivacy(port: PreferencePort) {
  let state: BalancePrivacySnapshot = Object.freeze({ status: 'loading', hidden: true });
  let pending: Promise<unknown> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: BalancePrivacySnapshot) => {
    const published = Object.freeze(next);
    state = published;
    for (const listener of [...listeners]) {
      if (state !== published) break;
      if (listeners.has(listener)) { try { listener(); } catch { /* Display observers cannot change persistence. */ } }
    }
  };
  const reload = (): Promise<void> => {
    if (pending) return pending.then(() => undefined);
    const task = Promise.resolve().then(port.get).then(raw => {
      if (raw !== null && raw !== 'hidden' && raw !== 'visible') throw new Error('Invalid privacy preference');
      publish({ status: 'ready', hidden: raw === 'hidden' });
    }).catch(() => { publish({ status: 'unavailable', hidden: true }); })
      .finally(() => { if (pending === task) pending = undefined; });
    pending = task;
    publish({ status: 'loading', hidden: true });
    return task;
  };
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload,
    save(hidden: boolean): Promise<boolean> {
      if (pending || typeof hidden !== 'boolean' || state.status !== 'ready') return Promise.resolve(false);
      const raw = hidden ? 'hidden' : 'visible';
      const task = Promise.resolve().then(() => port.set(raw)).then(async () => {
        if (await port.get() !== raw) throw new Error('Privacy preference was not confirmed');
        publish({ status: 'ready', hidden });
        return true;
      }).catch(() => { publish({ status: 'unavailable', hidden: true }); return false; })
        .finally(() => { if (pending === task) pending = undefined; });
      pending = task;
      // Hiding takes effect before I/O; revealing waits for the saved value.
      publish({ status: 'saving', hidden: state.hidden || hidden });
      return task;
    },
  });
}
