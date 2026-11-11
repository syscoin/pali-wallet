import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNativeTranslation } from '../platform/localization';
import { HIDDEN_BALANCE, useBalancePrivacy } from '../platform/balancePrivacy';
import { Coin, colors, Icon, Text } from '../ui';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';
import { compactActivityAmountLabel } from '../activity/activityAmountLabel';
import type { AssetIconIdentity } from '../../../../source/shared/assetIconIdentity';

export type NetworkSourceOption = Readonly<{
  id: string;
  name: string;
  symbol: string;
  testnet?: boolean;
  chainId?: string;
  iconId?: string;
  assetIcon?: AssetIconIdentity;
  iconRegistrationHash?: string;
  /** A public observation for this exact account and network, never a fallback. */
  available?: string;
  loading?: boolean;
}>;

/** Presentation only. Its caller owns network authority and balance observations. */
export function NetworkSourceSheet({ purpose, options, selectedId, busy = false, error, overContent = false, title, subtitle, search, loading, onSelect, onClose }: {
  purpose: 'send' | 'receive' | 'filter';
  options: readonly NetworkSourceOption[];
  selectedId: string;
  busy?: boolean;
  error?: string;
  overContent?: boolean;
  title?: string;
  subtitle?: string;
  search?: { value: string; onChange(value: string): void; placeholder: string };
  loading?: boolean;
  onSelect(id: string): void | Promise<void>;
  onClose(): void;
}) {
  const { t } = useNativeTranslation();
  const { hidden } = useBalancePrivacy();
  return <View style={[s.overlay, overContent && s.dimmed]}>
    <IdlePressable accessibilityRole="button" accessibilityLabel={t('buttons.close')}
      style={StyleSheet.absoluteFill} onPress={onClose} />
    <SafeAreaView testID="network-source-sheet" edges={['bottom']} style={s.sheet} accessibilityViewIsModal>
      <View style={s.handle} />
      <View style={s.header}>
        <View style={s.heading}>
          <Text accessibilityRole="header" style={s.title}>{title ?? t(purpose === 'send' ? 'mobile.networks.sendFrom' : purpose === 'receive' ? 'mobile.networks.receiveOn' : 'mobile.networks.title')}</Text>
          <Text style={s.subtitle}>{subtitle ?? t(purpose === 'send' ? 'mobile.networks.chooseSource' : purpose === 'receive' ? 'mobile.networks.chooseDestination' : 'mobile.networks.choose')}</Text>
        </View>
        <IdlePressable accessibilityRole="button" accessibilityLabel={t('buttons.close')} onPress={onClose} style={s.close}>
          <Icon name="close" size={22} />
        </IdlePressable>
      </View>
      {search && <IdleTextInput accessibilityLabel={search.placeholder} placeholder={search.placeholder} placeholderTextColor={colors.muted}
        value={search.value} onChangeText={search.onChange} autoCapitalize="none" autoCorrect={false} maxLength={80} style={s.search} />}
      {loading && <Text style={s.subtitle}>{t('buttons.loading')}</Text>}
      <FlatList style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        data={options} keyExtractor={option => option.id} initialNumToRender={10} maxToRenderPerBatch={12} windowSize={5}
        renderItem={({ item: option, index }) => {
          const selected = option.id === selectedId;
          const balance = option.available === undefined ? option.loading ? t('buttons.loading') : '—'
            : t('mobile.networks.availableBalance', { amount: hidden ? HIDDEN_BALANCE : compactActivityAmountLabel(option.available), symbol: option.symbol });
          return <IdlePressable key={option.id} accessibilityRole="radio"
            accessibilityLabel={t('mobile.networks.networkLabel', { name: option.name, symbol: option.symbol,
              chain: option.chainId ? t('mobile.networks.chainSuffix', { chainId: option.chainId }) : '',
              testnet: option.testnet ? t('mobile.networks.testSuffix') : '', capability: '' })}
            accessibilityHint={option.available === undefined ? undefined : hidden ? HIDDEN_BALANCE : `${option.available} ${option.symbol}`}
            accessibilityState={{ checked: selected, disabled: busy }} aria-checked={selected} disabled={busy}
            onPress={() => { void onSelect(option.id); }} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && s.pressed]}>
            {option.id === 'all' ? <View style={{ width: 38, alignItems: 'center' }}><Icon name="globe" size={26} color={colors.blue} /></View> : <Coin id={option.iconId ?? option.id} asset={option.assetIcon} registrationHash={option.iconRegistrationHash} fallbackSymbol={option.symbol} size={38} />}
            <View style={s.details}>
              <Text style={s.name} numberOfLines={2}>{option.name}</Text>
              {option.testnet && <Text style={s.testnet}>{t('mobile.common.testNetwork')}</Text>}
              {option.id !== 'all' && <Text testID={`network-source-balance-${option.id}`} style={s.balance} numberOfLines={2}>{balance}</Text>}
            </View>
            <View style={s.selection}>
              <Icon name={selected ? 'check' : 'chevron-right'} color={selected ? colors.blue : colors.muted} size={20} />
            </View>
          </IdlePressable>;
        }} ListEmptyComponent={<Text style={s.feedback}>{t('mobile.networks.noMatches')}</Text>} />
      {busy && <Text accessibilityLiveRegion="polite" style={s.feedback}>{t('mobile.networks.switching')}</Text>}
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[s.feedback, s.error]}>{error}</Text>}
    </SafeAreaView>
  </View>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#040c17' },
  dimmed: { backgroundColor: '#020812b8' },
  sheet: { maxHeight: '74%', minHeight: 220, paddingHorizontal: 20, backgroundColor: colors.surface,
    borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginTop: 9, marginBottom: 16, backgroundColor: '#617f9d' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 15 },
  heading: { flex: 1, gap: 5 },
  title: { fontSize: 23, lineHeight: 29, fontWeight: '600' },
  subtitle: { fontSize: 13, lineHeight: 19, color: colors.muted },
  search: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, fontSize: 14, paddingHorizontal: 12, marginBottom: 12 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  list: { flexShrink: 1, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  listContent: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, minHeight: 76 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  details: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  balance: { fontSize: 13, lineHeight: 19, color: colors.muted, fontVariant: ['tabular-nums'] },
  testnet: { fontSize: 12, lineHeight: 17, color: colors.muted },
  selection: { width: 24, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  feedback: { color: colors.muted, fontSize: 13, lineHeight: 20, paddingVertical: 12 },
  error: { color: colors.red },
});
