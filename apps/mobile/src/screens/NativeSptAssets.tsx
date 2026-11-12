import { nativeI18n, useNativeTranslation } from '../platform/localization';
import { HIDDEN_BALANCE, useBalancePrivacy } from '../platform/balancePrivacy';
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { sptBalanceTotalUnits, type SptBalance } from '../../../../source/shared/sptInventory';
import { formatBalanceDelta, formatBaseUnits } from '../core/amounts';
import { Button, Card, Coin, colors, Row, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';
const t = nativeI18n.t.bind(nativeI18n);

type Props = {
  holdings: readonly SptBalance[] | null;
  chainId?: number;
  loading: boolean;
  onSend?(asset: SptBalance): void;
  onReceive?(): void;
  onRefresh(): void;
  onModeChange(title: string | null): void;
  onBackHandlerChange(handler: (() => boolean) | null): void;
};
const PAGE_SIZE = 20;

/** Public asset inventory from the shared Blockbook account parser; no extra lookup. */
export function NativeSptAssets({ holdings, chainId, loading, onSend, onReceive, onRefresh, onModeChange, onBackHandlerChange }: Props) {
  useNativeTranslation();
  const { hidden: hideBalances } = useBalancePrivacy();
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
      <Coin id="spt" asset={chainId === undefined ? undefined : { kind: 'spt', chainId, assetGuid: selected.assetGuid, decimals: asset?.decimals }} fallbackSymbol={asset?.symbol ?? selected.symbol} size={48} />
      <Text style={s.heading}>{asset?.symbol ?? selected.symbol}</Text>
      <Text selectable style={s.muted}>{t('mobile.activityViews.nativeSptAssets.assetId', { id: selected.assetGuid })}</Text>
      {asset ? <>
        <Text style={s.amount}>{hideBalances ? HIDDEN_BALANCE : formatBaseUnits(asset.confirmedUnits, asset.decimals)} {asset.symbol}</Text>
        {asset.pendingDeltaUnits !== '0' && <Text style={s.muted}>{t('mobile.activityViews.nativeSptAssets.pendingBalance', { amount: hideBalances ? HIDDEN_BALANCE : formatBalanceDelta(asset.pendingDeltaUnits, asset.decimals), symbol: asset.symbol })}</Text>}
        <View style={s.actions}>
          {onSend && sptBalanceTotalUnits(asset) !== '0' && <Button title={t('buttons.send')} size="compact" style={s.action} icon="arrow-up-right" onPress={() => onSend(asset)} />}
          {onReceive && <Button title={t('buttons.receive')} size="compact" style={s.action} icon="arrow-down-left" variant="secondary" onPress={onReceive} />}
        </View>
      </> : <Text style={s.muted}>{loading ? t('mobile.activityViews.nativeSptAssets.loadingBalance') : t('mobile.accountPortfolio.balanceUnavailable')}</Text>}
      <Button title={loading ? t('mobile.activityViews.nativeSptAssets.refreshing') : t('mobile.infrastructure.refresh')} variant="secondary" size="compact" icon="refresh" disabled={loading} onPress={onRefresh} />
    </Card>
    <Button title={t('mobile.activityViews.nativeSptAssets.allTokens')} variant="secondary" size="compact" icon="arrow-left" onPress={() => setSelected(null)} />
  </View>;
  return <View style={s.section}>
    <Text accessibilityRole="header" style={s.heading}>{t('mobile.activityViews.nativeSptAssets.tokens')}</Text>
    {holdings === null ? <Text style={s.muted}>{loading ? t('mobile.activityViews.nativeSptAssets.loadingTokens') : t('mobile.activityViews.nativeSptAssets.tokenBalancesUnavailable')}</Text> : !holdings.length ?
      <Text style={s.muted}>{t('mobile.activityViews.nativeSptAssets.noTokenHoldings')}</Text> : <>
      <IdleTextInput accessibilityLabel={t('mobile.activityViews.nativeSptAssets.searchTokens')} placeholder={t('mobile.activityViews.nativeSptAssets.searchNameOrAssetID')} placeholderTextColor={colors.muted} value={query} onChangeText={value => { setQuery(value); setPage(0); }} maxLength={128} autoCorrect={false} autoCapitalize="none" style={s.search} />
      <Card>{rows.map((item, index) => <Row dense key={item.assetGuid} title={item.symbol} icon={<Coin id="spt" asset={chainId === undefined ? undefined : { kind: 'spt', chainId, assetGuid: item.assetGuid, decimals: item.decimals }} fallbackSymbol={item.symbol} size={32} />}
        subtitle={`${hideBalances ? HIDDEN_BALANCE : formatBaseUnits(item.confirmedUnits, item.decimals)} · ${t('mobile.activityViews.nativeSptAssets.assetId', { id: item.assetGuid })}${item.pendingDeltaUnits !== '0' ? ` · ${t('mobile.activityViews.nativeSptAssets.pendingActivity')}` : ''}`}
        onPress={() => setSelected({ assetGuid: item.assetGuid, symbol: item.symbol })} last={index === rows.length - 1} />)}</Card>
      {!rows.length && <Text style={s.muted}>{t('mobile.activityViews.nativeSptAssets.noMatchingTokens')}</Text>}
      {lastPage > 0 && <View style={s.pages}>
        <Button title={t('mobile.noteFlows.inventory.previous')} variant="secondary" size="compact" disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} />
        <Text style={s.muted}>{(currentPage + 1).toLocaleString(nativeI18n.resolvedLanguage)} / {(lastPage + 1).toLocaleString(nativeI18n.resolvedLanguage)}</Text>
        <Button title={t('buttons.next')} variant="secondary" size="compact" disabled={currentPage === lastPage} onPress={() => setPage(currentPage + 1)} />
      </View>}
    </>}
  </View>;
}
const s = StyleSheet.create({
  section: { gap: 12 }, actions: { flexDirection: 'row', gap: 8 }, action: { flex: 1, minWidth: 0, paddingHorizontal: 10 }, detail: { padding: 16, gap: 12 }, heading: { fontSize: 18, fontWeight: '700' },
  amount: { fontSize: 26, lineHeight: 36, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 22 },
  search: { minHeight: 48, color: colors.text, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14 },
  pages: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
