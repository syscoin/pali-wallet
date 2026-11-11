import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { assetMarketLine, type AssetMarket } from '../../../../source/shared/assetMarket.ts';
import { useFiatCurrency } from '../platform/fiatPreferences.ts';
import { walletFetch } from '../platform/http.ts';
import { Button, Card, colors, Text } from '../ui';
import { createNativeAssetMarketReader, nativeAssetMarketSource, rememberNativeAssetMarketIcon, type AssetMarketReference } from './nativeAssetMarket.ts';

const read = createNativeAssetMarketReader(walletFetch);
export function AssetMarketCard({ asset }: { asset: AssetMarketReference }) {
  const { kind, networkId, contractAddress, registration } = asset;
  const source = useMemo(() => nativeAssetMarketSource({ kind, networkId, contractAddress, registration }), [kind, networkId, contractAddress, registration]);
  const preference = useFiatCurrency(source !== null), currency = preference.status === 'ready' ? preference.currency : null;
  const key = JSON.stringify([source, currency]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; status: 'loading' | 'unavailable' | 'ready'; data?: AssetMarket }>({ key, status: 'loading' });
  useEffect(() => {
    if (!source || !currency) return;
    let owner: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { owner?.abort(); owner = undefined; clearTimeout(timer); };
    const hide = () => { stop(); setState({ key, status: 'loading' }); };
    const start = () => {
      if (owner || AppState.currentState !== 'active') return;
      const current = new AbortController(); owner = current;
      setState({ key, status: 'loading' });
      void read(source, currency, current.signal).then(data => {
        if (current.signal.aborted || AppState.currentState !== 'active') return;
        if (data) rememberNativeAssetMarketIcon({ kind, networkId, contractAddress, registration }, data);
        setState({ key, status: data ? 'ready' : 'unavailable', ...(data ? { data } : {}) });
        timer = setTimeout(() => { stop(); start(); }, 300_000);
      });
    };
    const lifecycle = AppState.addEventListener('change', value => value === 'active' ? start() : hide());
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', hide) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', start) : null;
    start(); return () => { stop(); lifecycle.remove(); blur?.remove(); focus?.remove(); };
  }, [source, currency, key, retry, kind, networkId, contractAddress, registration]);
  if (!source) return <Card style={s.card} testID="asset-market-card"><Text style={s.label}>Market price</Text><Text style={s.caption}>Market data is unavailable for this asset.</Text></Card>;
  const current = state.key === key ? state : null, data = current?.data;
  const format = (value: number) => `${new Intl.NumberFormat(undefined, {
    notation: value !== 0 && (value < 1e-8 || value >= 1e15) ? 'scientific' : 'standard',
    maximumFractionDigits: value < 1 ? 8 : 2,
  }).format(value)} ${currency?.toUpperCase() ?? ''}`;
  const prices = data?.prices ?? [];
  const min = prices.length ? Math.min(...prices) : 0;
  const path = assetMarketLine(prices);
  return <Card style={s.card} testID="asset-market-card">
    <View style={s.heading}><Text style={s.label}>Market price</Text><Text style={s.caption}>7 days</Text></View>
    {preference.status === 'unavailable' || preference.status === 'unsupported' ? <Text style={s.caption}>Choose a display currency in Settings to view market data.</Text>
      : !current || current.status === 'loading' || !currency ? <ActivityIndicator accessibilityLabel="Loading market data" color={colors.blue} /> : !data ? <View style={s.empty}>
      <Text style={s.caption}>Market data is unavailable.</Text><Button title="Try again" variant="quiet" size="compact" onPress={() => setRetry(value => value + 1)} />
    </View> : <>
      <View style={s.heading}><Text style={s.price}>{format(data.price)}</Text>{data.change24h !== null && <Text style={{ color: data.change24h >= 0 ? colors.green : colors.red, fontSize: 13 }}>{data.change24h > 0 ? '+' : ''}{data.change24h.toFixed(2)}% · 24h</Text>}</View>
      {path ? <View accessible accessibilityRole="image" accessibilityLabel={`Price over seven days, lowest ${format(min)}, highest ${format(Math.max(...prices))}`}>
        <Svg width="100%" height={128} viewBox="0 0 300 120" preserveAspectRatio="none"><Path d={path} fill="none" stroke={colors.blue} strokeWidth={2} /></Svg>
      </View> : <Text style={s.caption}>Price history is unavailable.</Text>}
      {(data.low24h !== null || data.high24h !== null) && <View style={s.heading}><View><Text style={s.caption}>24h low</Text><Text style={s.stat}>{data.low24h === null ? '—' : format(data.low24h)}</Text></View><View style={s.alignEnd}><Text style={s.caption}>24h high</Text><Text style={s.stat}>{data.high24h === null ? '—' : format(data.high24h)}</Text></View></View>}
      {data.marketCap !== null && <View style={s.heading}><Text style={s.caption}>Market cap</Text><Text style={s.stat}>{format(data.marketCap)}</Text></View>}
      <Text style={s.attribution}>CoinGecko · Updated {new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
    </>}
  </Card>;
}
const s = StyleSheet.create({
  card: { padding: 16, gap: 12 }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  label: { fontSize: 14, fontWeight: '600' }, caption: { fontSize: 12, lineHeight: 18, color: colors.muted },
  price: { fontSize: 21, lineHeight: 29, fontWeight: '600' }, stat: { fontSize: 13, lineHeight: 20 }, alignEnd: { alignItems: 'flex-end' },
  attribution: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'right' }, empty: { gap: 4 },
});
