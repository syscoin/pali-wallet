import React, { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import type { Erc20Metadata } from '../../../../source/shared/erc20';
import { formatTokenUnits } from '../../../../source/shared/erc20';
import type { NativeSendContext } from '../custody/networkContext';
import type { NativeTokenItem } from '../portfolio/nativeTokens';
import { useNativeTranslation } from '../platform/localization';
import { HIDDEN_BALANCE, useBalancePrivacy } from '../platform/balancePrivacy';
import { compactActivityAmountLabel } from '../activity/activityAmountLabel';
import { Coin, colors, Icon, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { NetworkSourceSheet } from './NetworkSourceSheet';

export type SendAssetItem = Pick<NativeTokenItem, 'metadata' | 'status' | 'units'>;

/** Asset selection is local to the current account/network; this component performs no reads. */
export function SendAssetSelector({ context, token, nativeAvailable, items, open, busy, loading, unavailable,
  onOpen, onClose, onSelect }: {
  context: NativeSendContext; token?: Erc20Metadata; nativeAvailable?: string;
  items: readonly SendAssetItem[]; open: boolean; busy: boolean; loading: boolean; unavailable?: boolean;
  onOpen(): void; onClose(): void; onSelect(token?: Erc20Metadata): void;
}) {
  const { t } = useNativeTranslation();
  const { hidden } = useBalancePrivacy();
  const [query, setQuery] = useState('');
  const amount = token ? items.find(item => item.metadata.contractAddress === token.contractAddress)?.units : nativeAvailable;
  const amountText = amount === undefined || amount === null ? '—' : token ? formatTokenUnits(amount, token.decimals) : amount;
  const options = [{ id: 'native', name: context.name, symbol: context.symbol, iconId: context.networkId, available: nativeAvailable },
    ...items.map(item => ({ id: item.metadata.contractAddress, name: item.metadata.name, symbol: item.metadata.symbol,
      iconId: item.metadata.contractAddress, available: item.units === null ? undefined : formatTokenUnits(item.units, item.metadata.decimals) }))]
    .filter(item => !query.trim() || `${item.name} ${item.symbol} ${item.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <Text style={s.label}>{t('mobile.sendAssets.label')}</Text>
    <IdlePressable accessibilityRole="button" accessibilityLabel={t('mobile.sendAssets.change')} disabled={busy}
      onPress={() => { setQuery(''); onOpen(); }} style={s.card}>
      <Coin id={token?.contractAddress ?? context.networkId} fallbackSymbol={token?.symbol ?? context.symbol} size={34} />
      <View style={s.details}><Text style={s.name} numberOfLines={1}>{token?.name ?? context.name}</Text>
        <Text style={s.help} accessibilityLabel={hidden ? HIDDEN_BALANCE : `${amountText} ${token?.symbol ?? context.symbol}`}>
          {hidden ? HIDDEN_BALANCE : compactActivityAmountLabel(amountText)} {token?.symbol ?? context.symbol} · {context.name}
        </Text></View><Icon name="chevron-down" size={18} color={colors.muted} />
    </IdlePressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <NetworkSourceSheet purpose="filter" title={t('mobile.sendAssets.choose')} subtitle={context.name} overContent
        options={options} selectedId={token?.contractAddress ?? 'native'} busy={busy} loading={loading}
        search={{ value: query, onChange: setQuery, placeholder: t('mobile.sendAssets.search') }}
        error={unavailable ? t('mobile.sendAssets.unavailable') : undefined} onClose={onClose}
        onSelect={id => {
          const next = id === 'native' ? undefined : items.find(item => item.metadata.contractAddress === id)?.metadata;
          if (id !== 'native' && !next) return;
          if ((next?.contractAddress ?? '') !== (token?.contractAddress ?? '')) onSelect(next); else onClose();
        }} />
    </Modal>
  </>;
}
const s = StyleSheet.create({
  card: { minHeight: 74, padding: 13, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center' },
  details: { flex: 1, minWidth: 0, gap: 5 }, name: { fontSize: 14, fontWeight: '600' }, help: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  label: { fontSize: 13, color: colors.muted },
});
