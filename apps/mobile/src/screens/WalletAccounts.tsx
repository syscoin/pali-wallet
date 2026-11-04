import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountIdentity, projectAccounts, type AccountSelection } from '../core/accountDirectory';
import type { WatchAccountState } from '../core/watchAccounts';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';
import { AddWatchAccount } from './Onboarding';

export type WalletAccountsProps = {
  catalogue: NativeWalletCatalogueSnapshot | null;
  watch: WatchAccountState;
  active: AccountSelection | null;
  onSelect(selection: AccountSelection): void | Promise<void>;
  onAdd(input: { name: string; address: string }): Promise<void>;
  onRename(id: string, name: string): Promise<void>;
  onRemove(id: string): Promise<void>;
  onRetry(): Promise<void>;
  onBack(): void;
  onManageHd?(): void;
  onOpenWallet?(): void;
};
export type WatchWalletBridge = Pick<WalletAccountsProps, 'watch' | 'onAdd' | 'onRename' | 'onRemove' | 'onRetry'> & {
  onSelectWatch(selection: AccountSelection): void;
  onNativeCatalogue(catalogue: NativeWalletCatalogueSnapshot | null): void;
};

/** Shared public chooser. It receives no signing, backup or authentication authority. */
export function WalletAccounts(props: WalletAccountsProps) {
  const onBack = props.onBack;
  const [form, setForm] = useState<{ kind: 'rename' | 'remove'; id: string; name: string; address: string } | 'add' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const working = useRef(false);
  const back = useRef(() => undefined as void);
  useLayoutEffect(() => { back.current = () => { if (busy) return; if (form) { setForm(null); setError(''); } else onBack(); }; }, [busy, form, onBack]);
  useEffect(() => { active.current = true; const listener = BackHandler.addEventListener('hardwareBackPress', () => { back.current(); return true; });
    return () => { active.current = false; listener.remove(); }; }, []);
  const run = async (operation: () => void | Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); if (active.current) setForm(null); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'This account change could not be completed.'); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  const entries = projectAccounts(props.catalogue, props.watch.accounts);
  const selected = props.active ? accountIdentity(props.active) : null;
  const canManageWatch = props.watch.status === 'ready' && !props.watch.busy && !busy;
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}><KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {form === 'add' ? <AddWatchAccount onAdd={props.onAdd} onCancel={() => setForm(null)} /> : <Screen footer={form ? <Button title={form.kind === 'rename' ? 'Save name' : 'Remove watch account'} disabled={!canManageWatch || form.kind === 'rename' && !name.trim()} onPress={() => void run(() => form.kind === 'rename' ? props.onRename(form.id, name) : props.onRemove(form.id))} /> : undefined}>
      <Header title={form ? form.kind === 'rename' ? 'Rename watch account' : 'Remove watch account' : 'Accounts'} subtitle="Wallet and public EVM addresses" onBack={() => back.current()} />
      {props.watch.status === 'opening' && <View style={s.loading}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>Opening saved watch accounts…</Text></View>}
      {props.watch.status === 'unavailable' && <><Notice title="Watch accounts unavailable" body="Your saved watch data has been preserved. Reopen it before making changes." tone="amber" /><Button title="Reopen watch accounts" disabled={busy || props.watch.busy} variant="secondary" onPress={() => void run(props.onRetry)} /></>}
      {form && typeof form !== 'string' ? <>
        <Notice title={form.name} body={form.kind === 'remove' ? 'This removes only the public address saved on this device. It does not move funds. You can add this address again.' : 'Names are saved on this device and do not change the public address.'} />
        <Text selectable style={s.address}>{form.address}</Text>
        {form.kind === 'rename' && <><Text style={styles.muted}>Account name</Text><TextInput accessibilityLabel="Watch account name" value={name} onChangeText={setName} editable={!busy} maxLength={40} autoCorrect={false} style={s.input} /></>}
      </> : <>
        <Text style={styles.muted}>Wallet accounts unlock through your wallet. Imported keys need separate backups. Watch accounts can view balances and receive addresses only.</Text>
        {entries.map((entry) => <Card key={entry.identity} style={s.account}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Select ${entry.name} (${entry.selection.kind !== 'watch' ? 'wallet' : 'watch-only'})`} disabled={busy || props.watch.busy || entry.selection.kind === 'watch' && props.watch.status !== 'ready'} onPress={() => void run(() => props.onSelect(entry.selection))}>
            <View style={s.row}><Text style={s.name}>{entry.name}</Text>{entry.identity === selected && <Text style={s.selected}>Selected</Text>}</View>
            <Text style={s.kind}>{entry.selection.kind === 'hd' ? 'Recovery phrase account' : entry.selection.kind === 'imported' ? 'Imported key · Separate backup' : 'Watch-only · Public EVM address'}</Text>
            <Text selectable style={s.address}>{entry.address}</Text>
          </Pressable>
          {entry.selection.kind === 'watch' && <View style={s.actions}>
            <Button title={`Rename ${entry.name}`} variant="quiet" disabled={!canManageWatch} onPress={() => { setName(entry.name); setForm({ kind: 'rename', id: entry.selection.id, name: entry.name, address: entry.address }); setError(''); }} />
            <Button title={`Remove ${entry.name}`} variant="quiet" disabled={!canManageWatch} onPress={() => { setForm({ kind: 'remove', id: entry.selection.id, name: entry.name, address: entry.address }); setError(''); }} />
          </View>}
        </Card>)}
        {props.onManageHd && <Button title="Manage wallet accounts" variant="secondary" disabled={busy} onPress={props.onManageHd} />}
        {props.onOpenWallet && <Button title="Open wallet" variant="secondary" disabled={busy} onPress={props.onOpenWallet} />}
        <Button title="Watch an address" disabled={!canManageWatch} onPress={() => { setForm('add'); setError(''); }} />
        <Text style={s.kind}>EVM public addresses only. Extended public keys and output descriptors are not supported.</Text>
      </>}
      {(busy || props.watch.busy) && <ActivityIndicator accessibilityLabel="Saving account change" color={colors.pink} />}
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    </Screen>}
  </KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, account: { padding: 18, gap: 12 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, name: { fontSize: 17, fontWeight: '600', flexShrink: 1 }, selected: { fontSize: 12, color: colors.green }, kind: { fontSize: 12, lineHeight: 20, color: colors.muted, marginTop: 6 }, address: { fontSize: 13, lineHeight: 22, color: colors.muted, marginTop: 6 }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }, input: { color: colors.text, fontSize: 16, minHeight: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 }, loading: { alignItems: 'center', gap: 12 }, error: { color: colors.red, fontSize: 14, lineHeight: 22 } });
