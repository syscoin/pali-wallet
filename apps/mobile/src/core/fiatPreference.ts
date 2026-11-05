import { FIAT_QUOTE_CURRENCIES } from '../../../../source/shared/nativeCoinQuotes.ts';
import type { PreferencePort } from './securityPreferences.ts';

export const DEFAULT_FIAT_CURRENCY = 'usd';
export type FiatCurrency = (typeof FIAT_QUOTE_CURRENCIES)[number];
export const isFiatCurrency = (value: unknown): value is FiatCurrency =>
  (FIAT_QUOTE_CURRENCIES as readonly unknown[]).includes(value);

type Snapshot = Readonly<{ status: 'loading' | 'unavailable' | 'unsupported' } | { status: 'ready'; currency: FiatCurrency }>;

export function createFiatPreferences(port: PreferencePort) {
  let state: Snapshot = { status: 'loading' };
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => {
    state = next;
    for (const listener of listeners) {
      try { listener(); } catch { /* A view cannot interrupt preference publication. */ }
    }
  };
  const reload = () => {
    if (pending) return pending;
    pending = Promise.resolve().then(port.get).then((saved) => {
      publish(saved === null || isFiatCurrency(saved) ? { status: 'ready', currency: saved ?? DEFAULT_FIAT_CURRENCY } : { status: 'unsupported' });
    }).catch(() => { publish({ status: 'unavailable' }); }).finally(() => { pending = undefined; });
    publish({ status: 'loading' });
    return pending;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload,
    async save(currency: FiatCurrency): Promise<boolean> {
      if (pending || !isFiatCurrency(currency) ||
          (state.status !== 'ready' && !(state.status === 'unsupported' && currency === DEFAULT_FIAT_CURRENCY))) return false;
      let saved = false;
      pending = Promise.resolve().then(() => port.set(currency)).then(async () => {
        if (await port.get() !== currency) throw new Error('Unconfirmed currency');
        saved = true;
        publish({ status: 'ready', currency });
      }).catch(() => { publish({ status: 'unavailable' }); }).finally(() => { pending = undefined; });
      await pending;
      return saved;
    },
  };
}
