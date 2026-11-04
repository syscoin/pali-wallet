import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeAccountRequest, NativeAccountView } from '../custody/accounts';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';

type Form = { kind: 'create' | 'rename' | 'remove' | 'restore'; id?: string; index?: number; label: string; address?: string; catalogueRevision: number; contextRevision: number };
function failure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BUSY') return 'Wait for the current wallet operation to finish.';
  if (code === 'INVALID_CREDENTIAL') return 'That password is incorrect. Unlock your wallet to try again.';
  if (code === 'AUTH_THROTTLED') return 'Too many incorrect passwords. Wait a few minutes before trying again.';
  if (code === 'INVALID_INPUT') return 'Enter a name of up to 64 characters and your wallet password.';
  if (code === 'ACCOUNT_LIMIT') return 'Account limit reached. Use an existing account or restore a removed one. If you have 20 active accounts, remove one first.';
  if (code === 'ACCOUNT_NOT_REMOVABLE') return 'Select another account before removing this one. Account 1 must remain on this device.';
  if (code === 'PENDING_TRANSFER') return 'This account has an unresolved transfer. Check its transaction status before removing it.';
  if (code === 'CANCELLED' || code === 'NOT_READY') return 'Your wallet context changed. Unlock it and try again.';
  return 'The account change could not be completed. Your saved wallet has been preserved.';
}

/** Real native account UI; the controller alone owns derivation and persistence. */
export function NativeAccounts({ controller, onBack }: { controller: NativeAccountView; onBack(): void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removedPage, setRemovedPage] = useState(0);
  const working = useRef(false);
  const lifetime = useRef({ alive: true, epoch: 0 });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => { latestBack.current = onBack; }, [onBack]);
  const subscribe = useCallback((listener: () => void) => controller.subscribe(() => {
    setPassword(''); setForm(null); setName(''); listener();
  }), [controller]);
  const snapshot = useSyncExternalStore(subscribe, controller.getSnapshot, controller.getSnapshot);
  const close = useCallback(() => {
    lifetime.current.epoch++; controller.cancel(); Keyboard.dismiss(); setPassword(''); latestBack.current();
  }, [controller]);
  useEffect(() => {
    const localLifetime = lifetime.current;
    localLifetime.alive = true;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => { localLifetime.alive = false; localLifetime.epoch++; controller.cancel(); listener.remove(); };
  }, [controller, close]);
  const open = (value: Omit<Form, 'catalogueRevision' | 'contextRevision'>) => {
    if (!snapshot || working.current) return;
    setError(''); setPassword(''); setName(value.label);
    setForm({ ...value, catalogueRevision: snapshot.revision, contextRevision: controller.getContextRevision() });
  };
  const run = async (request: NativeAccountRequest, contextRevision: number, catalogueRevision: number) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setPassword(''); Keyboard.dismiss();
    const epoch = lifetime.current.epoch;
    try {
      await controller.execute(request, contextRevision, catalogueRevision);
      if (lifetime.current.alive && epoch === lifetime.current.epoch) { setForm(null); setName(''); }
    } catch (cause) {
      if (lifetime.current.alive && epoch === lifetime.current.epoch) setError(failure(cause));
    } finally {
      working.current = false;
      if (lifetime.current.alive && epoch === lifetime.current.epoch) { setBusy(false); setPassword(''); }
    }
  };
  const submit = () => {
    if (!form || busy) return;
    let entered = password;
    const request: NativeAccountRequest = form.kind === 'create' ? { kind: 'create', label: name.trim(), password: entered }
      : form.kind === 'restore' ? { kind: 'restore', index: form.index!, label: name.trim(), password: entered }
      : form.kind === 'remove' ? { kind: 'remove', id: form.id!, password: entered }
      : { kind: 'rename', id: form.id!, label: name.trim() };
    void run(request, form.contextRevision, form.catalogueRevision).finally(() => { entered = ''; });
  };
  const field = (title: string, value: string, change: (text: string) => void, secret = false) => <View style={s.field}>
    <Text style={s.label}>{title}</Text><TextInput accessibilityLabel={title} value={value} onChangeText={change}
      editable={!busy} maxLength={secret ? 1024 : 64} secureTextEntry={secret} autoCapitalize="none" autoCorrect={false}
      spellCheck={false} autoComplete="off" textContentType="none" importantForAutofill="noExcludeDescendants" style={s.input} />
  </View>;
  const removedPages = Math.max(1, Math.ceil((snapshot?.removed.length ?? 0) / 20));
  const page = Math.min(removedPage, removedPages - 1);
  const needsPassword = form && form.kind !== 'rename';
  const title = !form ? 'Accounts' : form.kind === 'create' ? 'Add an account' : form.kind === 'restore' ? 'Restore an account' : form.kind === 'remove' ? 'Remove account' : 'Rename account';
  return <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}><KeyboardAvoidingView style={s.safeArea} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen footer={form ? <Button title={form.kind === 'create' ? 'Create account' : form.kind === 'restore' ? 'Restore account' : form.kind === 'remove' ? 'Remove from this device' : 'Save name'}
      disabled={busy || (form.kind !== 'remove' && !name.trim()) || !!needsPassword && !password} onPress={submit} /> : undefined}>
      <Header title={title} subtitle="Ethereum · Recovery phrase accounts" onBack={() => { if (form && !busy) { setForm(null); setPassword(''); setError(''); } else close(); }} />
      {busy ? <Notice title="Saving account change…" body="Keep Pali open while your wallet completes this request." /> : !snapshot ? <Notice title="Wallet locked" body="Unlock your wallet to manage its accounts." /> : form ? <>
        {!!form.address && <Card style={s.identity}><Text style={s.name}>{form.label}</Text><Text selectable style={s.address}>{form.address}</Text></Card>}
        {form.kind === 'remove' ? <Notice title="Your funds stay at this address" body="Removing an account hides it on this device. You can restore this recovery-phrase account from Removed accounts. This does not move funds or cancel transactions." tone="amber" /> : <>
          {field('Account name', name, setName)}
          {form.kind !== 'rename' && <Notice title={form.kind === 'restore' ? 'Return to the same address' : 'One recovery phrase, another address'} body={form.kind === 'restore' ? 'Pali will restore the original account address.' : 'This account is derived from your existing recovery phrase. Keep that phrase backed up offline.'} />}
        </>}
        {needsPassword && field('Confirm wallet password', password, setPassword, true)}
      </> : <>
        <Text style={styles.muted}>Choose the account you want to use. Each account has its own Ethereum address.</Text>
        {snapshot.accounts.map((account) => <Card key={account.id} style={s.account}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Select ${account.label}`} disabled={busy}
            onPress={() => { if (account.id !== snapshot.active.accountId) void run({ kind: 'select', id: account.id }, controller.getContextRevision(), snapshot.revision); }}>
            <View style={s.row}><Text style={s.name}>{account.label}</Text>{account.id === snapshot.active.accountId && <Text style={s.selected}>Selected</Text>}</View>
            <Text selectable style={s.address}>{account.address}</Text>
          </Pressable>
          <View style={s.actions}><Button title="Rename" variant="quiet" onPress={() => open({ kind: 'rename', id: account.id, label: account.label, address: account.address })} />
            {account.index !== 0 && account.id !== snapshot.active.accountId && <Button title="Remove" variant="quiet" onPress={() => open({ kind: 'remove', id: account.id, label: account.label, address: account.address })} />}</View>
        </Card>)}
        <Button title="Add account" onPress={() => open({ kind: 'create', label: '' })} />
        {snapshot.removed.length > 0 && <><Text style={s.section}>Removed accounts</Text><Text style={styles.muted}>Restore an earlier account without changing your recovery phrase.</Text>
          <Text style={styles.muted}>{`Page ${page + 1} of ${removedPages} · ${snapshot.removed.length} removed accounts`}</Text>
          {snapshot.removed.slice(page * 20, (page + 1) * 20).map((account) => <Button key={account.id} title={`Restore Account ${account.index + 1}`} variant="secondary" onPress={() => open({ kind: 'restore', index: account.index, label: `Account ${account.index + 1}` })} />)}
          {removedPages > 1 && <View style={s.actions}><Button title="Previous" variant="quiet" disabled={page === 0} onPress={() => setRemovedPage(page - 1)} /><Button title="Next" variant="quiet" disabled={page === removedPages - 1} onPress={() => setRemovedPage(page + 1)} /></View>}
        </>}
      </>}
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
      <Text style={s.buildLabel}>Development build · Use a test wallet</Text>
    </Screen>
  </KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg }, field: { gap: 10 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 17, minHeight: 56, fontSize: 16 },
  account: { padding: 18, gap: 8 }, identity: { padding: 18, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  name: { fontSize: 17, fontWeight: '600', flexShrink: 1 }, selected: { color: colors.green, fontSize: 12 },
  address: { fontSize: 13, lineHeight: 22, color: colors.muted, marginTop: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }, section: { fontSize: 20, fontWeight: '600' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 }, buildLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
