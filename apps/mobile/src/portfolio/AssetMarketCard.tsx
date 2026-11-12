import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { assetMarketCoordinates, assetMarketLine, type AssetMarket } from '../../../../source/shared/assetMarket.ts';
import { useFiatCurrency } from '../platform/fiatPreferences.ts';
import { walletFetch } from '../platform/http.ts';
import { Button, Card, colors, Text } from '../ui';
import { createNativeAssetMarketReader, nativeAssetMarketSource, rememberNativeAssetMarketIcon, type AssetMarketReference } from './nativeAssetMarket.ts';
import { useNativeTranslation } from '../platform/localization';

const read = createNativeAssetMarketReader(walletFetch);
export function AssetMarketCard({ asset }: { asset: AssetMarketReference }) {
  const { t, i18n } = useNativeTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { kind, networkId, contractAddress, registration } = asset;
  const source = useMemo(() => nativeAssetMarketSource({ kind, networkId, contractAddress, registration }), [kind, networkId, contractAddress, registration]);
  const preference = useFiatCurrency(source !== null), currency = preference.status === 'ready' ? preference.currency : null;
  const key = JSON.stringify([source, currency]);
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<{ key: string; data: AssetMarket; index: number } | null>(null);
  const chartWidth = useRef(300);
  const [state, setState] = useState<{ key: string; status: 'loading' | 'unavailable' | 'ready'; data?: AssetMarket }>({ key, status: 'loading' });
  useEffect(() => {
    if (!source || !currency) return;
    let owner: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { owner?.abort(); owner = undefined; clearTimeout(timer); };
    const hide = () => { stop(); setSelection(null); setState({ key, status: 'loading' }); };
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
  const dataForPlot = state.key === key ? state.data : undefined;
  const plot = useMemo(() => {
    const prices = dataForPlot?.prices ?? [];
    return { points: assetMarketCoordinates(prices), path: assetMarketLine(prices),
      minimum: prices.length ? Math.min(...prices) : 0, maximum: prices.length ? Math.max(...prices) : 0 };
  }, [dataForPlot]);
  const { points, path } = plot;
  if (!source) return <Card style={s.card} testID="asset-market-card"><Text style={s.label}>{t('mobile.portfolioCopy.marketPrice')}</Text><Text style={s.caption}>{t('mobile.portfolioCopy.marketUnavailableForAsset')}</Text></Card>;
  const current = state.key === key ? state : null, data = current?.data;
  const format = (value: number) => `${new Intl.NumberFormat(locale, {
    notation: value !== 0 && (value < 1e-8 || value >= 1e15) ? 'scientific' : 'standard',
    maximumFractionDigits: value < 1 ? 8 : 2,
  }).format(value)} ${currency?.toUpperCase() ?? ''}`;
  const prices = data?.prices ?? [];
  const selected = selection?.key === key && selection.data === data ? selection.index : null;
  const marker = selected === null ? null : points?.[selected];
  const select = (index: number) => {
    if (!data || !points) return;
    const next = Math.min(prices.length - 1, Math.max(0, Math.round(index)));
    setSelection(current => current?.key === key && current.data === data && current.index === next ? current : { key, data, index: next });
  };
  const inspect = (x: number) => {
    if (Number.isFinite(x) && chartWidth.current > 0) select(x / chartWidth.current * (prices.length - 1));
  };
  // The seven-day sparkline has no per-sample timestamps; report its relative day only.
  const selectedPosition = selected === null ? null : t('mobile.chartInteraction.historyDay', { day: 1 + Math.floor(selected / Math.max(1, prices.length - 1) * 6) });
  return <Card style={s.card} testID="asset-market-card">
    <View style={s.heading}><Text style={s.label}>{t('mobile.portfolioCopy.marketPrice')}</Text><Text style={s.caption}>{t('mobile.portfolioCopy.sevenDays')}</Text></View>
    {preference.status === 'unavailable' || preference.status === 'unsupported' ? <Text style={s.caption}>{t('mobile.portfolioCopy.chooseCurrency')}</Text>
      : !current || current.status === 'loading' || !currency ? <ActivityIndicator accessibilityLabel={t('mobile.portfolioCopy.loadingMarket')} color={colors.blue} /> : !data ? <View style={s.empty}>
      <Text style={s.caption}>{t('mobile.portfolioCopy.marketUnavailable')}</Text><Button title={t('mobile.connections.tryAgain')} variant="quiet" size="compact" onPress={() => setRetry(value => value + 1)} />
    </View> : <>
      <View style={s.heading}><Text style={s.price}>{format(selected === null ? data.price : prices[selected]!)}</Text>{selectedPosition ? <Text style={s.caption}>{selectedPosition}</Text> : data.change24h !== null && <Text style={{ color: data.change24h >= 0 ? colors.green : colors.red, fontSize: 13 }}>{t('mobile.portfolioCopy.change24h', { value: `${data.change24h > 0 ? '+' : ''}${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(data.change24h)}` })}</Text>}</View>
      {path && points ? <View accessible accessibilityRole="adjustable"
        accessibilityLabel={t('mobile.chartInteraction.priceHistory')}
        accessibilityHint={`${t('mobile.portfolioCopy.priceRange', { minimum: format(plot.minimum), maximum: format(plot.maximum) })}. ${t('mobile.chartInteraction.inspectHint')}`}
        accessibilityValue={{ min: 1, max: prices.length, now: (selected ?? prices.length - 1) + 1,
          text: `${format(prices[selected ?? prices.length - 1]!)}, ${selectedPosition ?? t('mobile.chartInteraction.historyDay', { day: 7 })}` }}
        accessibilityActions={[{ name: 'increment', label: t('mobile.chartInteraction.nextPrice') }, { name: 'decrement', label: t('mobile.chartInteraction.previousPrice') }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') select((selected ?? prices.length - 1) + 1); else if (event.nativeEvent.actionName === 'decrement') select((selected ?? prices.length - 1) - 1); }}
        onLayout={event => { const width = event.nativeEvent.layout.width; if (Number.isFinite(width) && width > 0) chartWidth.current = width; }}
        onTouchStart={event => inspect(event.nativeEvent.locationX)}
        onTouchMove={event => inspect(event.nativeEvent.locationX)}
        onTouchEnd={() => setSelection(null)} onTouchCancel={() => setSelection(null)} testID="asset-market-chart">
        <Svg width="100%" height={128} viewBox="0 0 300 120" preserveAspectRatio="none" accessibilityElementsHidden pointerEvents="none">
          <Path d={path} fill="none" stroke={colors.blue} strokeWidth={2} />
          {marker && <><Line x1={marker.x} y1={4} x2={marker.x} y2={116} stroke={colors.muted} strokeWidth={1} strokeDasharray="3 3" /><Circle cx={marker.x} cy={marker.y} r={4} fill={colors.blue} stroke={colors.bg} strokeWidth={2} /></>}
        </Svg>
        <View pointerEvents="none"><Text style={s.caption}>{t('mobile.chartInteraction.dragHint')}</Text></View>
      </View> : <Text style={s.caption}>{t('mobile.portfolioCopy.historyUnavailable')}</Text>}
      {(data.low24h !== null || data.high24h !== null) && <View style={s.heading}><View><Text style={s.caption}>{t('mobile.portfolioCopy.low24h')}</Text><Text style={s.stat}>{data.low24h === null ? '—' : format(data.low24h)}</Text></View><View style={s.alignEnd}><Text style={s.caption}>{t('mobile.portfolioCopy.high24h')}</Text><Text style={s.stat}>{data.high24h === null ? '—' : format(data.high24h)}</Text></View></View>}
      {data.marketCap !== null && <View style={s.heading}><Text style={s.caption}>{t('mobile.portfolioCopy.marketCap')}</Text><Text style={s.stat}>{format(data.marketCap)}</Text></View>}
      <Text style={s.attribution}>{t('mobile.portfolioCopy.updatedAt', { time: new Date(data.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</Text>
    </>}
  </Card>;
}
const s = StyleSheet.create({
  card: { padding: 16, gap: 12 }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  label: { fontSize: 14, fontWeight: '600' }, caption: { fontSize: 12, lineHeight: 18, color: colors.muted },
  price: { fontSize: 21, lineHeight: 29, fontWeight: '600' }, stat: { fontSize: 13, lineHeight: 20 }, alignEnd: { alignItems: 'flex-end' },
  attribution: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'right' }, empty: { gap: 4 },
});
