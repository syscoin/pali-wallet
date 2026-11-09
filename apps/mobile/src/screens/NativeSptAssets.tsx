import React, { useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { sptBalanceTotalUnits, type SptBalance } from '../../../../source/shared/sptInventory';
import { formatBalanceDelta, formatBaseUnits } from '../core/amounts';
import { Button, Card, colors, Row, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

type Props = {
  holdings: readonly SptBalance[] | null;
  loading: boolean;
  onSend?(asset: SptBalance): void;
  onRefresh(): void;
  onModeChange(title: string | null): void;
  onBackHandlerChange(handler: (() => boolean) | null): void;
};
const PAGE_SIZE = 20;

/** Public asset inventory from the shared Blockbook account parser; no extra lookup. */
export function NativeSptAssets({ holdings, loading, onSend, onRefresh, onModeChange, onBackHandlerChange }: Props) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Pick<SptBalance, 'assetGuid' | 'symbol'> | null>(null);
  const asset = holdings?.find(item => item.assetGuid === selected?.assetGuid);
  const matching = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (holdings ?? []).filter(item => item.symbol.toLowerCase().includes(search) || item.assetGuid.includes(search));
  }, [holdings, query]);
  const lastPage = Math.max(0, Math.ceil(matching.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const rows = matching.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  useLayoutEffect(() => {
    onModeChange(selected ? asset?.symbol ?? selected.symbol : null);
    onBackHandlerChange(() => { if (!selected) return false; setSelected(null); return true; });
    return () => { onModeChange(null); onBackHandlerChange(null); };
  }, [asset?.symbol, onBackHandlerChange, onModeChange, selected]);
  if (selected) return <View style={s.section}>
    <Card style={s.detail}>
      <Text style={s.heading}>{asset?.symbol ?? selected.symbol}</Text>
      <Text selectable style={s.muted}>Asset {selected.assetGuid}</Text>
      {asset ? <>
        <Text style={s.amount}>{formatBaseUnits(asset.confirmedUnits, asset.decimals)} {asset.symbol}</Text>
        {asset.pendingDeltaUnits !== '0' && <Text style={s.muted}>Pending {formatBalanceDelta(asset.pendingDeltaUnits, asset.decimals)} {asset.symbol}</Text>}
        {onSend && sptBalanceTotalUnits(asset) !== '0' && <Button title="Send" onPress={() => onSend(asset)} />}
      </> : <Text style={s.muted}>{loading ? 'Loading balance…' : 'Balance unavailable'}</Text>}
      <Button title={loading ? 'Refreshing…' : 'Refresh'} variant="quiet" disabled={loading} onPress={onRefresh} />
    </Card>
    <Button title="All tokens" variant="secondary" onPress={() => setSelected(null)} />
  </View>;
  return <View style={s.section}>
    <Text accessibilityRole="header" style={s.heading}>Tokens</Text>
    {holdings === null ? <Text style={s.muted}>{loading ? 'Loading tokens…' : 'Token balances unavailable'}</Text> : !holdings.length ?
      <Text style={s.muted}>No token holdings.</Text> : <>
      <IdleTextInput accessibilityLabel="Search tokens" placeholder="Search name or asset ID" placeholderTextColor={colors.muted} value={query} onChangeText={value => { setQuery(value); setPage(0); }} maxLength={128} autoCorrect={false} autoCapitalize="none" style={s.search} />
      <Card>{rows.map((item, index) => <Row key={item.assetGuid} title={item.symbol}
        subtitle={`${formatBaseUnits(item.confirmedUnits, item.decimals)} · Asset ${item.assetGuid}${item.pendingDeltaUnits !== '0' ? ' · Pending activity' : ''}`}
        onPress={() => setSelected({ assetGuid: item.assetGuid, symbol: item.symbol })} last={index === rows.length - 1} />)}</Card>
      {!rows.length && <Text style={s.muted}>No matching tokens.</Text>}
      {lastPage > 0 && <View style={s.pages}>
        <Button title="Previous" variant="secondary" disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} />
        <Text style={s.muted}>{currentPage + 1} / {lastPage + 1}</Text>
        <Button title="Next" variant="secondary" disabled={currentPage === lastPage} onPress={() => setPage(currentPage + 1)} />
      </View>}
    </>}
  </View>;
}
const s = StyleSheet.create({
  section: { gap: 14 }, detail: { padding: 18, gap: 12 }, heading: { fontSize: 18, fontWeight: '700' },
  amount: { fontSize: 26, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 22 },
  search: { minHeight: 48, color: colors.text, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14 },
  pages: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
