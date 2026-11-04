import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { importedKeyIdentity, normalizeImportedKey, type NativeImportView } from '../custody/importedAccounts';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';

type Props = {
  imports: NativeImportView;
  contextRevision: number;
  catalogueRevision: number;
  networkLabel: string;
  onImported(): void;
  onBack(): void;
  onSubmitStart(): void;
  onSubmitEnd(): void;
};

function failure(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : '';
  if (code === 'DUPLICATE_ACCOUNT') return 'This address is already a wallet account. Select that account instead.';
  if (code === 'ACCOUNT_LIMIT') return 'This wallet has reached its account limit. Use an existing account.';
  if (code === 'INVALID_INPUT') return 'Check the private key and account name, then review the address again.';
  if (code === 'BUSY') return 'Wait for the current wallet operation to finish, then try again.';
  if (code === 'INVALID_CREDENTIAL') return 'That password is incorrect. Unlock your wallet to try again.';
  if (code === 'AUTH_THROTTLED') return 'Too many incorrect passwords. Wait a few minutes before trying again.';
  if (code === 'CANCELLED' || code === 'NOT_READY') return 'Your wallet context changed. Unlock your wallet and try again.';
  return 'Import could not be confirmed. Unlock and check your accounts before trying again.';
}

/** Secrets remain inside this protected form and its private submit call. */
export function NativeImport({ imports, contextRevision, catalogueRevision, networkLabel, onImported, onBack, onSubmitStart, onSubmitEnd }: Props) {
  const [privateKey, setPrivateKey] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = useRef(Object.freeze({ contextRevision, catalogueRevision }));
  const lifetime = useRef({ mounted: false, request: 0, working: false });
  const latestBack = useRef(onBack);
  const clear = useCallback(() => {
    lifetime.current.request++;
    setPrivateKey(''); setPassword(''); setAddress(null); setAcknowledged(false); setError('');
    Keyboard.dismiss();
  }, []);
  const back = useCallback(() => {
    clear(); imports.cancel(); latestBack.current();
  }, [clear, imports]);
  useLayoutEffect(() => { latestBack.current = onBack; }, [onBack]);
  useLayoutEffect(() => {
    const state = lifetime.current;
    state.mounted = true;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    // The containing wallet revokes authority. Clear these local fields in the
    // same lifecycle event, before React's later unmount can retain a view.
    const change = AppState.addEventListener('change', (value) => { if (value !== 'active') clear(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', clear) : null;
    return () => {
      state.mounted = false; state.request++;
      imports.cancel(); hardware.remove(); change.remove(); blur?.remove();
    };
  }, [back, clear, imports]);

  const review = () => {
    if (lifetime.current.working) return;
    setError('');
    if (!name.trim() || name.trim().length > 64 || !name.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
      setError('Enter an account name of up to 64 characters.'); return;
    }
    try {
      const key = normalizeImportedKey(privateKey);
      setPrivateKey(key); setAddress(importedKeyIdentity(key, 0).address); setAcknowledged(false); setPassword('');
      Keyboard.dismiss();
    } catch {
      setError('Enter a valid 32-byte EVM private key. Recovery phrases, WIF and extended keys are not supported here.');
    }
  };
  const submit = async () => {
    const state = lifetime.current;
    if (!state.mounted || state.working || !privateKey || !address || !password || !acknowledged || AppState.currentState !== 'active') return;
    state.working = true; setBusy(true); setError('');
    const request = ++state.request;
    const input = { privateKey, label: name.trim(), expectedAddress: address };
    const entered = password;
    setPrivateKey(''); setPassword(''); Keyboard.dismiss();
    try {
      onSubmitStart();
      await imports.submit(input, entered, scope.current.contextRevision, scope.current.catalogueRevision);
      if (state.mounted && state.request === request) onImported();
    } catch (cause) {
      if (state.mounted && state.request === request) {
        setAddress(null); setAcknowledged(false); setError(failure(cause));
      }
      // Authenticated mutation failures publish the authority's typed feedback
      // themselves; an unmounted form must not replace a newer request's error.
    } finally {
      state.working = false;
      onSubmitEnd();
      if (state.mounted) setBusy(false);
    }
  };

  return <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={address ? <Button title="Import account" disabled={busy || !password || !acknowledged} onPress={submit} /> :
        <Button title="Review address" disabled={busy || !privateKey || !name.trim()} onPress={review} />}>
        <Header title={address ? 'Review imported account' : 'Import private key'} subtitle={`${networkLabel} · EVM account`} onBack={back} />
        <Notice title="Keep a separate copy of this key" body="Your recovery phrase cannot restore an imported account. Keep its original private key backed up securely before continuing." tone="amber" />
        {address ? <>
          <Card style={s.identity}><Text style={s.label}>{name.trim()}</Text><Text style={s.address}>{address}</Text></Card>
          <Text style={styles.muted}>Check the complete address. This key controls the same account across EVM networks; available send features depend on the selected network.</Text>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged, disabled: busy }} aria-checked={acknowledged} accessibilityLabel="I have a separate backup of this private key"
            disabled={busy} onPress={() => setAcknowledged((value) => !value)} style={s.checkRow}>
            <View style={[s.checkbox, acknowledged && s.checked]}><Text style={s.checkmark}>{acknowledged ? '✓' : ''}</Text></View>
            <Text style={s.checkLabel}>I have a separate backup of this private key.</Text>
          </Pressable>
          <View style={s.field}><Text style={s.label}>Confirm wallet password</Text><TextInput
            accessibilityLabel="Confirm wallet password" value={password} onChangeText={setPassword} editable={!busy} secureTextEntry
            autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none"
            importantForAutofill="noExcludeDescendants" maxLength={1024} style={s.input} />
          </View>
          {!busy && <Button title="Edit private key" variant="quiet" onPress={() => { setAddress(null); setPassword(''); setAcknowledged(false); setError(''); }} />}
        </> : <>
          <View style={s.field}><Text style={s.label}>Account name</Text><TextInput accessibilityLabel="Account name" value={name} onChangeText={setName}
            editable={!busy} maxLength={64} autoCorrect={false} autoComplete="off" style={s.input} /></View>
          <View style={s.field}><Text style={s.label}>EVM private key</Text><TextInput accessibilityLabel="EVM private key" value={privateKey} onChangeText={setPrivateKey}
            editable={!busy} secureTextEntry maxLength={1024} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
            textContentType="none" importantForAutofill="noExcludeDescendants" style={s.input} /></View>
          <Text style={styles.muted}>Use a 64-character hexadecimal EVM key, with or without 0x. The key stays hidden while you enter it.</Text>
        </>}
        {busy && <ActivityIndicator accessibilityLabel="Importing account" color={colors.pink} />}
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        <Text style={s.buildLabel}>Development build · Use a test wallet</Text>
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  field: { gap: 10 }, label: { color: colors.muted, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 17, minHeight: 56, fontSize: 16 },
  identity: { padding: 18, gap: 10 }, address: { fontSize: 14, lineHeight: 23 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  checkbox: { width: 24, height: 24, borderColor: colors.muted, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.pink, borderColor: colors.pink }, checkmark: { color: colors.bg, fontWeight: '700' },
  checkLabel: { flex: 1, lineHeight: 22 }, error: { color: colors.red, fontSize: 14, lineHeight: 21 },
  buildLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
