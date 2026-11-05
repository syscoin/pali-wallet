import { useLayoutEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import { useFiatCurrency } from '../platform/fiatPreferences';
import { walletFetch } from '../platform/http';
import { createNativeCoinQuoteReader, nativeCoinQuoteSource, type NativeCoinQuote } from './nativeCoinQuote.ts';

const read = createNativeCoinQuoteReader(walletFetch);
const displayPrice = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

/** Display only: the exact on-chain balance and send arithmetic stay separate. */
export function useNativeCoinQuote(id: string | null, amount: string | null, registration?: NativeNetworkRegistration | null): string | null {
  const available = amount !== null;
  const preference = useFiatCurrency(available);
  const currency = preference.status === 'ready' ? preference.currency : null;
  const sourceKey = id && currency && JSON.stringify([id, registration?.registrationHash, currency]);
  const [quote, setQuote] = useState<{ key: string; value: NativeCoinQuote } | null>(null);
  useLayoutEffect(() => {
    if (!id || !currency || !sourceKey || !available) return;
    const source = nativeCoinQuoteSource(id, registration);
    if (!source) return;
    let owner: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { owner?.abort(); owner = undefined; clearTimeout(timer); };
    const retire = () => { stop(); setQuote(null); };
    const start = () => {
      if (owner || AppState.currentState !== 'active') return;
      const request = new AbortController();
      owner = request;
      setQuote(null);
      void read(source, currency, request.signal).then((value) => {
        if (request.signal.aborted || AppState.currentState !== 'active' || !value) return;
        const expire = () => {
          if (request.signal.aborted) return;
          const remaining = value.expiresAt - performance.now();
          if (remaining > 0) timer = setTimeout(expire, Math.ceil(remaining));
          else setQuote(null);
        };
        if (value.expiresAt > performance.now()) {
          setQuote({ key: sourceKey, value });
          expire();
        }
      });
    };
    const change = AppState.addEventListener('change', (state) => { if (state === 'active') start(); else retire(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', retire) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', start) : null;
    start();
    return () => { stop(); change.remove(); blur?.remove(); focus?.remove(); };
  }, [id, sourceKey, available, registration, currency]);
  if (!available || !currency || !sourceKey || quote?.key !== sourceKey) return null;
  const value = Number(amount) * quote.value.price;
  if (!Number.isFinite(value)) return null;
  return `≈ ${displayPrice.format(value)} ${currency.toUpperCase()}`;
}
