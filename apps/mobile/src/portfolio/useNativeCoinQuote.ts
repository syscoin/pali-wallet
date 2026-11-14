import { useLayoutEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { utxoRegistrationData } from '../core/utxoNetworks.ts';
import { useFiatCurrency } from '../platform/fiatPreferences';
import { walletFetch } from '../platform/http';
import { createNativeCoinQuoteReader, nativeCoinQuoteSource, QUOTE_LIFETIME_MS, type NativeCoinQuote, type NativeCoinQuoteNetwork } from './nativeCoinQuote.ts';
import { formatIndicativeFiat } from './fiatDisplay.ts';
import { useNativeTranslation } from '../platform/localization';

const read = createNativeCoinQuoteReader(walletFetch);

/** Display only: the exact on-chain balance and send arithmetic stay separate. */
export function useNativeCoinQuote(registration: NativeCoinQuoteNetwork | null, amount: string | null): Readonly<{
  supported: boolean; quote: string | null;
}> {
  const { i18n } = useNativeTranslation();
  const source = useMemo(() => nativeCoinQuoteSource(registration), [registration]);
  const supported = source !== null;
  const available = amount !== null;
  const preference = useFiatCurrency(available);
  const currency = preference.status === 'ready' ? preference.currency : null;
  const sourceKey = source && registration && currency && JSON.stringify([
    registration.id, registration.kind === 'utxo' ? utxoRegistrationData(registration) : registration.registrationHash,
    source, currency,
  ]);
  const [quote, setQuote] = useState<{ key: string; value: NativeCoinQuote } | null>(null);
  useLayoutEffect(() => {
    if (!source || !currency || !sourceKey || !available) return;
    let owner: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { owner?.abort(); owner = undefined; clearTimeout(timer); };
    const retire = () => { stop(); setQuote(null); };
    const schedule = (request: AbortController, deadline: number) => {
      const renew = () => {
        if (owner !== request || request.signal.aborted || AppState.currentState !== 'active') return;
        const remaining = deadline - performance.now();
        if (remaining > 0) timer = setTimeout(renew, Math.ceil(remaining));
        else { owner = undefined; start(); }
      };
      renew();
    };
    const start = () => {
      if (owner || AppState.currentState !== 'active') return;
      const request = new AbortController();
      owner = request;
      setQuote(null);
      const settled = (value: NativeCoinQuote | null) => {
        if (owner !== request || request.signal.aborted || AppState.currentState !== 'active') return;
        if (value && value.expiresAt > performance.now()) {
          setQuote({ key: sourceKey, value });
          schedule(request, value.expiresAt);
        } else schedule(request, performance.now() + QUOTE_LIFETIME_MS);
      };
      void read(source, currency, request.signal).then(settled, () => settled(null));
    };
    const change = AppState.addEventListener('change', (state) => { if (state === 'active') start(); else retire(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', retire) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', start) : null;
    start();
    return () => { stop(); change.remove(); blur?.remove(); focus?.remove(); };
  }, [source, sourceKey, available, currency]);
  if (!supported || !available || !currency || !sourceKey || quote?.key !== sourceKey)
    return { supported, quote: null };
  const value = Number(amount) * quote.value.price;
  return { supported, quote: formatIndicativeFiat(value, currency, i18n.resolvedLanguage ?? i18n.language) };
}
