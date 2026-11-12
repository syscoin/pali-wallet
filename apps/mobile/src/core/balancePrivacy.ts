import type { PreferencePort } from './securityPreferences.ts';
import type { PublicViewAuthorization } from './publicViewLock.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';

export const HIDDEN_BALANCE = '••••';
export type BalancePrivacySnapshot = Readonly<{
  status: 'loading' | 'ready' | 'saving' | 'unavailable';
  hidden: boolean;
}>;

/** Display-only preference. Unknown persistence never exposes previously hidden amounts. */
export function createBalancePrivacy(port: PreferencePort, authorizeReveal: PublicViewAuthorization) {
  if (typeof authorizeReveal !== 'function') throw new Error('Privacy authorization unavailable');
  let state: BalancePrivacySnapshot = Object.freeze({ status: 'loading', hidden: true });
  let pending: Promise<unknown> | undefined;
  let repairHidden = false;
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
    const task = Promise.resolve().then(async () => {
      // A failed acknowledgement after a reveal must be repaired before this
      // process can accept a later read as permission to expose balances.
      if (repairHidden) {
        await port.set('hidden');
        if (await port.get() !== 'hidden') throw new Error('Privacy repair was not confirmed');
        repairHidden = false;
      }
      return port.get();
    }).then(raw => {
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
    save(hidden: boolean, signal: AbortSignal, assertCurrent: () => void): Promise<boolean> {
      const check = () => {
        if (!signal || signal.aborted) throw new Error('CANCELLED');
        assertSynchronousEvmFeeGuard(assertCurrent);
      };
      if (pending || typeof hidden !== 'boolean' || state.status !== 'ready') return Promise.resolve(false);
      try { check(); } catch { return Promise.resolve(false); }
      if (state.hidden === hidden) return Promise.resolve(true);
      const previous = state, revealing = !hidden;
      const raw = hidden ? 'hidden' : 'visible';
      let dispatched = false;
      const task = Promise.resolve().then(async () => {
        check();
        if (revealing) { await authorizeReveal(signal, check); check(); }
        dispatched = true;
        await port.set(raw); check();
        if (await port.get() !== raw) throw new Error('Privacy preference was not confirmed');
        check();
        publish({ status: 'ready', hidden });
        return true;
      }).catch(async () => {
        if (!dispatched) { publish(previous); return false; }
        if (revealing) {
          repairHidden = true;
          try {
            await port.set('hidden');
            if (await port.get() !== 'hidden') throw new Error('Privacy repair was not confirmed');
            repairHidden = false;
            publish({ status: 'ready', hidden: true });
            return false;
          } catch { /* Remain masked until a serialized repair succeeds. */ }
        }
        publish({ status: 'unavailable', hidden: true }); return false;
      })
        .finally(() => { if (pending === task) pending = undefined; });
      pending = task;
      // Hiding takes effect before I/O; revealing waits for the saved value.
      publish({ status: 'saving', hidden: state.hidden || hidden });
      return task;
    },
  });
}
