import { IdleTextInput } from './IdleActivityBoundary';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HdKeyExportFlow, HdKeyExportPresentation } from '../custody/hdKeyExport';
import { Button, Card, colors, Header, Notice, Row, Screen, styles, Text } from '../ui';

type Props = {
  keyExport: HdKeyExportFlow;
  keyFormat: 'evm' | { kind: 'wif' | 'extended'; networkLabel: string; addressType: string } | null;
  accountId: string;
  accountType: 'HDAccount' | 'Imported';
  accountLabel: string;
  address: string;
  onViewRecovery(): void;
  onRemoveWallet?(): void;
  onDeviceUnlock?(): void;
  deviceUnlockEnabled?: boolean;
  onLock(): void;
  onBack(): void;
  captureFailureHandler(): (error: unknown) => void;
};

/** Private presentation stays in this mounted, protected native screen only. */
export function NativeSecurity({ keyExport, keyFormat, accountId, accountType, accountLabel, address, onViewRecovery, onRemoveWallet, onDeviceUnlock, deviceUnlockEnabled, onLock, onBack, captureFailureHandler }: Props) {
  const [mode, setMode] = useState<'hub' | 'key' | 'recovery'>('hub');
  const [password, setPassword] = useState('');
  const [presentation, setPresentation] = useState<HdKeyExportPresentation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lifecycle = useRef({ mounted: false, operation: 0, request: 0, busy: false });
  const latestBack = useRef<() => void>(() => undefined);
  const clear = useCallback(() => {
    lifecycle.current.operation++;
    setPassword(''); setPresentation(null); setError('');
    Keyboard.dismiss();
  }, []);
  useLayoutEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    const unsubscribe = keyExport.onClear(clear);
    return () => {
      state.mounted = false; state.operation++;
      unsubscribe(); keyExport.cancel();
    };
  }, [keyExport, clear]);
  const hide = () => { lifecycle.current.request++; keyExport.cancel(); clear(); };
  const back = () => {
    hide();
    if (mode !== 'hub') setMode('hub'); else onBack();
  };
  useLayoutEffect(() => { latestBack.current = back; });
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { latestBack.current(); return true; });
    return () => subscription.remove();
  }, []);

  const reveal = async () => {
    const state = lifecycle.current;
    if (!keyFormat || !state.mounted || state.busy || !password) return;
    state.busy = true; setBusy(true); setError('');
    const entered = password; setPassword(''); Keyboard.dismiss();
    const request = ++state.request;
    const reportFailure = captureFailureHandler();
    // begin synchronously clears any previous presentation before its first await.
    const pending = keyExport.begin(entered);
    const operation = state.operation;
    try {
      const shown = await pending;
      if (state.mounted && state.operation === operation && keyExport.isCurrent(shown.id) &&
          shown.accountId === accountId && shown.address === address) setPresentation(shown);
    } catch (cause) {
      if (state.mounted && state.operation === operation) {
        setError('The private key could not be shown. Confirm your password and try again.');
      }
      const code = cause instanceof Error ? cause.message : '';
      // The flow's own failure lock can unmount this screen before the promise
      // settles. Its captured parent handler checks the actual locked context.
      if (state.request === request && (code === 'INVALID_CREDENTIAL' || code === 'AUTH_THROTTLED')) {
        reportFailure(cause);
      }
    } finally {
      state.busy = false;
      if (state.mounted) setBusy(false);
    }
  };
  const shown = presentation && presentation.accountId === accountId && presentation.address === address &&
    keyExport.isCurrent(presentation.id) ? presentation : null;
  const utxo = keyFormat !== 'evm' ? keyFormat : null;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen><Header title={mode === 'key' ? 'Account private key' : mode === 'recovery' ? 'Recovery guide' : 'Security & backups'} subtitle="Development build · Use a test wallet" onBack={back} />
        {mode === 'hub' ? <>
          <Notice title={accountType === 'Imported' ? 'Imported key needs a separate backup' : 'Recovery phrase backed up'} body={accountType === 'Imported' ? 'Your recovery phrase cannot restore this account. Keep its original private key backed up separately.' : 'Your written recovery phrase restores the accounts derived from this wallet. Keep it private and offline.'} />
          <Card><Row title="View recovery phrase" subtitle="Confirm your password to view your words" icon="shield" onPress={() => { hide(); onViewRecovery(); }} />
            {keyFormat && <Row title="Reveal account private key" subtitle={accountLabel} icon="eye" onPress={() => { hide(); setMode('key'); }} />}
            {onDeviceUnlock && <Row title="Biometric unlock" subtitle={deviceUnlockEnabled ? 'On' : 'Off'} icon="lock" onPress={() => { hide(); onDeviceUnlock(); }} />}
            <Row title="Recovery guide" subtitle="Understand what your backups restore" icon="help" onPress={() => { hide(); setMode('recovery'); }} last /></Card>
          <Button title="Lock wallet" variant="secondary" icon="lock" onPress={() => { hide(); onLock(); }} />
          {onRemoveWallet && <Button title="Remove wallet from this device" variant="danger" onPress={() => { hide(); onRemoveWallet(); }} />}
        </> : mode === 'recovery' ? <>
          <Text style={s.heading}>Keep your recovery phrase offline</Text>
          <Text style={styles.muted}>Your recovery phrase restores this wallet’s derived accounts. Keep a separate backup of each imported private key.</Text>
          <Text style={styles.muted}>If you forget this device’s password, lock your wallet and choose Forgot password? to verify the matching recovery phrase and preserve supported saved records. On a new or lost device, the phrase restores derived accounts; imported keys still need their separate backups.</Text>
          <Notice title="Keep secrets to yourself" body="Pali support will never ask for recovery words, private keys or your password. Never enter them into a website or send them to anyone." tone="amber" />
        </> : <>
          <Card style={s.identity}><Text style={s.label}>{accountLabel}</Text>
            {utxo && <Text style={s.label}>{utxo.networkLabel} · {utxo.addressType}</Text>}
            <Text style={s.address}>{address}</Text></Card>
          {utxo?.kind === 'extended'
            ? <Notice title="Keep this account key private" body="This extended private key can spend from every address in this account. Reveal it only in a private place." tone="amber" />
            : utxo?.kind === 'wif'
            ? <Notice title="Keep this key private" body="Anyone with this WIF key can spend from this address. To restore it, select the network and address type shown above." tone="amber" />
            : <Notice title="This key controls one EVM account" body="Anyone with this key can spend from this account on EVM networks. It does not back up the rest of your wallet. Reveal it only in a private place." tone="amber" />}
          {shown ? <>
            <View style={s.secret}><Text style={s.key}>{shown.privateKey}</Text></View>
            <Button title="Hide private key" onPress={hide} />
            <Text style={styles.muted}>The key is visible only for this session. Hiding it requires a fresh password confirmation to reveal it again.</Text>
          </> : <>
            <View style={s.field}><Text style={s.label}>Confirm your wallet password</Text><IdleTextInput
              accessibilityLabel="Confirm your wallet password" value={password} onChangeText={setPassword} editable={!busy}
              autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
              importantForAutofill="noExcludeDescendants" textContentType="none" secureTextEntry contextMenuHidden={false}
              maxLength={1024} selectionColor={colors.pink} placeholderTextColor={colors.muted} style={s.input}
            /></View>
            <Button title="Reveal private key" disabled={busy || !password} onPress={reveal} />
            {busy && <ActivityIndicator accessibilityLabel="Confirming password" color={colors.pink} />}
          </>}
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        </>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  heading: { fontSize: 24, lineHeight: 32, fontWeight: '600' },
  identity: { padding: 18, gap: 10 }, label: { color: colors.muted, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  address: { fontSize: 14, lineHeight: 23 }, field: { gap: 10 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 17, minHeight: 56, fontSize: 16 },
  secret: { padding: 20, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.amber, borderWidth: 1 },
  key: { fontSize: 16, lineHeight: 26, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
