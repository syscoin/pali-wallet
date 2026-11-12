import { useNativeTranslation } from '../platform/localization';
import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountIdentity, projectAccounts, type AccountSelection } from '../core/accountDirectory';
import type { WatchUtxoNetworksView } from '../core/publicAccountStorage';
import type { WatchAccountState } from '../core/watchAccounts';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue';
import { Button, Card, colors, Header, IconButton, Notice, Screen, styles, Text } from '../ui';
import { AddWatchAccount } from './Onboarding';
import type { WatchAccountNetwork } from '../core/watchOnlyAuthority';
import { getNetwork } from '../core/networks';

export type WalletAccountsProps = {
  catalogue: NativeWalletCatalogueSnapshot | null;
  watch: WatchAccountState;
  active: AccountSelection | null;
  onSelect(selection: AccountSelection): void | Promise<void>;
  onAdd(input: { name: string; address: string; network?: WatchAccountNetwork }): Promise<void>;
  availableWatchNetworks?: readonly WatchAccountNetwork[];
  networkSettings?: WatchUtxoNetworksView;
  onNetworksChanged?(): Promise<void>;
  onRename(id: string, name: string): Promise<void>;
  onRemove(id: string): Promise<void>;
  onRetry(): Promise<void>;
  onBack(): void;
  onManageHd?(): void;
  onOpenWallet?(): void;
};
export type WatchWalletBridge = Pick<WalletAccountsProps, 'watch' | 'onAdd' | 'onRename' | 'onRemove' | 'onRetry' | 'availableWatchNetworks' | 'networkSettings' | 'onNetworksChanged'> & {
  onSelectWatch(selection: AccountSelection): void;
  onNativeCatalogue(catalogue: NativeWalletCatalogueSnapshot | null): void;
};

/** Shared public chooser. It receives no signing, backup or authentication authority. */
export function WalletAccounts(props: WalletAccountsProps) {
  const { t } = useNativeTranslation();
  const onBack = props.onBack;
  const [form, setForm] = useState<{ kind: 'rename' | 'remove'; id: string; name: string; address: string } | 'add' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const working = useRef(false);
  const back = useRef<() => boolean>(() => false);
  useLayoutEffect(() => { back.current = () => { if (form === 'add') return false; if (busy) return true; if (form) { setForm(null); setError(''); } else onBack(); return true; }; }, [busy, form, onBack]);
  useEffect(() => { active.current = true; const listener = BackHandler.addEventListener('hardwareBackPress', () => back.current());
    return () => { active.current = false; listener.remove(); }; }, []);
  const run = async (operation: () => void | Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); if (active.current) setForm(null); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : t('mobile.shellViews.walletAccounts.thisAccountChangeCouldNotBeCompleted')); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  const entries = projectAccounts(props.catalogue, props.watch.accounts);
  const selected = props.active ? accountIdentity(props.active) : null;
  const canManageWatch = props.watch.status === 'ready' && !props.watch.busy && !busy;
  const accessibleIdentity = (entry: (typeof entries)[number]) => {
    if (entry.kind === 'watch') {
      const account = props.watch.accounts.find(value => value.id === entry.selection.id)!;
      const grouped = new Map<string, ReturnType<typeof getNetwork>[]>();
      for (const [id, address] of Object.entries(account.addresses)) {
        if (address === undefined) continue;
        const networks = grouped.get(address) ?? [];
        networks.push(getNetwork(id as Parameters<typeof getNetwork>[0], props.watch.utxoNetworks));
        grouped.set(address, networks);
      }
      const addresses = Array.from(grouped, ([address, networks]) =>
        `${networks.length > 1 && networks.every(network => network.kind === 'evm')
          ? t('mobile.shellViews.walletAccounts.publicEvmAddress') : networks.map(network => network.name).join(' / ')}, ${address}`);
      return t('mobile.shellViews.accounts.watchIdentity', { name: entry.name, addresses: addresses.join('; ') });
    }
    const kind = entry.kind === 'hd' ? t('mobile.accounts.phrase') : entry.kind === 'imported' ? t('mobile.shellViews.walletAccounts.importedKey')
      : entry.kind === 'smart' ? t('smartAccountHub.menuEntry') : entry.kind === 'ledger' ? t('mobile.accounts.ledger') : t('mobile.shellViews.walletAccounts.trezorHardwareWallet');
    return t('mobile.shellViews.accounts.walletIdentity', { name: entry.name, kind, address: entry.address });
  };
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}><KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {form === 'add' ? <AddWatchAccount utxoNetworks={props.watch.utxoNetworks} networkSettings={props.networkSettings} onNetworksChanged={props.onNetworksChanged} availableNetworks={props.availableWatchNetworks} onAdd={props.onAdd} onCancel={() => setForm(null)} /> : <Screen footer={form ? <Button title={form.kind === 'rename' ? t('mobile.accounts.saveName') : t('mobile.shellViews.walletAccounts.removeWatchAccount')} disabled={!canManageWatch || form.kind === 'rename' && !name.trim()} onPress={() => void run(() => form.kind === 'rename' ? props.onRename(form.id, name) : props.onRemove(form.id))} /> : undefined}>
      <Header title={form ? form.kind === 'rename' ? t('mobile.shellViews.walletAccounts.renameWatchAccount') : t('mobile.shellViews.walletAccounts.removeWatchAccount') : t('mobile.accounts.title')} subtitle={t('mobile.shellViews.walletAccounts.walletAndWatchAccounts')} onBack={() => back.current()} />
      {props.watch.status === 'opening' && <View style={s.loading}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>{t('mobile.shellViews.walletAccounts.openingSavedWatchAccounts')}</Text></View>}
      {props.watch.status === 'unavailable' && <><Notice title={t('mobile.shellViews.walletAccounts.watchAccountsUnavailable')} body={t('mobile.shellViews.walletAccounts.yourSavedWatchDataHasBeenPreservedReopen')} tone="amber" /><Button title={t('mobile.shellViews.walletAccounts.reopenWatchAccounts')} disabled={busy || props.watch.busy} variant="secondary" onPress={() => void run(props.onRetry)} /></>}
      {form && typeof form !== 'string' ? <>
        <Notice title={form.name} body={form.kind === 'remove' ? t('mobile.shellViews.walletAccounts.thisRemovesTheWatchAccountFromThisDevice') : t('mobile.shellViews.walletAccounts.namesAreSavedOnThisDeviceAndDo')} />
        <Text selectable style={s.address}>{form.address}</Text>
        {form.kind === 'rename' && <><Text style={styles.muted}>{t('mobile.accounts.accountName')}</Text><IdleTextInput accessibilityLabel={t('mobile.shellViews.walletAccounts.watchAccountName')} value={name} onChangeText={setName} editable={!busy} maxLength={40} autoCorrect={false} style={s.input} /></>}
      </> : <>
        <Text style={styles.muted}>{t('mobile.shellViews.walletAccounts.walletAccountsUnlockThroughYourWalletImportedKeys')}</Text>
        {entries.map((entry) => <Card key={entry.identity} style={s.account}>
          <IdlePressable accessibilityRole="button" accessibilityLabel={t('mobile.shellViews.accounts.selectIdentity', { identity: accessibleIdentity(entry), selected: entry.identity === selected ? t('mobile.shellViews.accounts.selectedSuffix') : '' })}
            accessibilityState={{ selected: entry.identity === selected, disabled: busy || props.watch.busy || entry.selection.kind === 'watch' && props.watch.status !== 'ready' }}
            disabled={busy || props.watch.busy || entry.selection.kind === 'watch' && props.watch.status !== 'ready'} onPress={() => void run(() => props.onSelect(entry.selection))}>
            <View style={s.row}><Text style={s.name}>{entry.name}</Text>{entry.identity === selected && <Text style={s.selected}>{t('mobile.language.selected')}</Text>}</View>
            <Text style={s.kind}>{entry.selection.kind === 'hd' ? t('mobile.accounts.phrase') : entry.selection.kind === 'imported' ? t('mobile.accounts.imported') : entry.selection.kind === 'smart' ? t('smartAccountHub.menuEntry') : entry.selection.kind === 'ledger' ? t('mobile.accounts.ledger') : entry.selection.kind === 'trezor' ? t('mobile.shellViews.walletAccounts.trezor') : (() => {
              const watched = props.watch.accounts.find((account) => account.id === entry.selection.id)!;
              const network = getNetwork(Object.keys(watched.addresses)[0] as Parameters<typeof getNetwork>[0], props.watch.utxoNetworks);
              return network.kind === 'utxo' ? t('mobile.shellViews.accounts.watchNetwork', { network: network.name }) : t('mobile.shellViews.walletAccounts.watchOnlyPublicEvmAddress');
            })()}</Text>
            <Text selectable style={s.address}>{entry.address}</Text>
          </IdlePressable>
          {entry.selection.kind === 'watch' && <View style={s.actions}>
            <IconButton label={t('mobile.shellViews.accounts.renameIdentity', { identity: accessibleIdentity(entry) })} icon="edit" disabled={!canManageWatch} onPress={() => { setName(entry.name); setForm({ kind: 'rename', id: entry.selection.id, name: entry.name, address: entry.address }); setError(''); }} />
            <IconButton label={t('mobile.shellViews.accounts.removeIdentity', { identity: accessibleIdentity(entry) })} icon="trash" disabled={!canManageWatch} onPress={() => { setForm({ kind: 'remove', id: entry.selection.id, name: entry.name, address: entry.address }); setError(''); }} />
          </View>}
        </Card>)}
        {props.onManageHd && <Button title={t('mobile.shellViews.walletAccounts.manageWalletAccounts')} variant="secondary" disabled={busy} onPress={props.onManageHd} />}
        {props.onOpenWallet && <Button title={t('mobile.shellViews.app.openWallet')} variant="secondary" disabled={busy} onPress={props.onOpenWallet} />}
        <Button title={t('mobile.welcome.watch')} disabled={!canManageWatch} onPress={() => { setForm('add'); setError(''); }} />
        <Text style={s.kind}>{t('mobile.shellViews.walletAccounts.useAPublicAddressAccountKeyOrSupported')}</Text>
      </>}
      {(busy || props.watch.busy) && <ActivityIndicator accessibilityLabel={t('mobile.shellViews.walletAccounts.savingAccountChange')} color={colors.pink} />}
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    </Screen>}
  </KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, account: { padding: 18, gap: 12 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, name: { fontSize: 17, fontWeight: '600', flexShrink: 1 }, selected: { fontSize: 12, color: colors.green }, kind: { fontSize: 12, lineHeight: 20, color: colors.muted, marginTop: 6 }, address: { fontSize: 13, lineHeight: 22, color: colors.muted, marginTop: 6 }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }, input: { color: colors.text, fontSize: 16, minHeight: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 }, loading: { alignItems: 'center', gap: 12 }, error: { color: colors.red, fontSize: 14, lineHeight: 22 } });
