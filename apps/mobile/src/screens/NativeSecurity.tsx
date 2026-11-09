import { useNativeTranslation } from '../platform/localization';
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
  accountType: 'HDAccount' | 'Imported' | 'SmartAccount' | 'Ledger' | 'Trezor';
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
  const { t } = useNativeTranslation();
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
        setError(t('mobile.security.revealFailed'));
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
  let backupTitle = t('mobile.security.phraseBackedUp');
  let backupBody = t('mobile.security.phraseBackup');
  if (accountType === 'Ledger' || accountType === 'Trezor') {
    backupTitle = t('mobile.security.hardwareTitle', { device: accountType });
    backupBody = t('mobile.security.hardwareBody', { device: accountType });
  } else if (accountType === 'Imported') {
    backupTitle = t('mobile.security.importBackupTitle');
    backupBody = t('mobile.security.importBackupBody');
  }

  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen><Header title={mode === 'key' ? t('mobile.security.accountKey') : mode === 'recovery' ? t('mobile.security.recoveryGuide') : t('mobile.security.title')} subtitle={t('mobile.common.development')} onBack={back} />
        {mode === 'hub' ? <>
          <Notice title={backupTitle} body={backupBody} />
          <Card><Row title={accountType === 'Ledger' || accountType === 'Trezor' ? t('mobile.security.viewPaliPhrase') : t('mobile.security.viewPhrase')} subtitle={t('mobile.security.passwordWords')} icon="shield" onPress={() => { hide(); onViewRecovery(); }} />
            {keyFormat && (accountType === 'HDAccount' || accountType === 'Imported') && <Row title={t('mobile.security.revealAccountKey')} subtitle={accountLabel} icon="eye" onPress={() => { hide(); setMode('key'); }} />}
            {onDeviceUnlock && <Row title={t('mobile.security.biometric')} subtitle={deviceUnlockEnabled ? t('mobile.security.on') : t('mobile.security.off')} icon="lock" onPress={() => { hide(); onDeviceUnlock(); }} />}
            <Row title={t('mobile.security.recoveryGuide')} subtitle={t('mobile.security.backupsRestore')} icon="help" onPress={() => { hide(); setMode('recovery'); }} last /></Card>
          <Button title={t('mobile.settings.lock')} variant="secondary" icon="lock" onPress={() => { hide(); onLock(); }} />
          {onRemoveWallet && <Button title={t('mobile.security.removeWallet')} variant="danger" onPress={() => { hide(); onRemoveWallet(); }} />}
        </> : mode === 'recovery' ? <>
          <Text style={s.heading}>{t('mobile.security.keepPhraseOffline')}</Text>
          {(accountType === 'Ledger' || accountType === 'Trezor') && <Text style={styles.muted}>{t('mobile.security.hardwareGuide', { device: accountType })}</Text>}
          <Text style={styles.muted}>{t('mobile.security.phraseRestore')}</Text>
          <Text style={styles.muted}>{t('mobile.security.forgotPassword')}</Text>
          <Notice title={t('mobile.security.secretTitle')} body={t('mobile.security.secretBody')} tone="amber" />
        </> : <>
          <Card style={s.identity}><Text style={s.label}>{accountLabel}</Text>
            {utxo && <Text style={s.label}>{utxo.networkLabel} · {utxo.addressType}</Text>}
            <Text style={s.address}>{address}</Text></Card>
          {utxo?.kind === 'extended'
            ? <Notice title={t('mobile.security.extendedTitle')} body={t('mobile.security.extendedBody')} tone="amber" />
            : utxo?.kind === 'wif'
            ? <Notice title={t('mobile.security.wifTitle')} body={t('mobile.security.wifBody')} tone="amber" />
            : <Notice title={t('mobile.security.evmTitle')} body={t('mobile.security.evmBody')} tone="amber" />}
          {shown ? <>
            <View style={s.secret}><Text style={s.key}>{shown.privateKey}</Text></View>
            <Button title={t('mobile.security.hide')} onPress={hide} />
            <Text style={styles.muted}>{t('mobile.security.sessionOnly')}</Text>
          </> : <>
            <View style={s.field}><Text style={s.label}>{t('mobile.security.confirmPassword')}</Text><IdleTextInput
              accessibilityLabel={t('mobile.security.confirmPassword')} value={password} onChangeText={setPassword} editable={!busy}
              autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
              importantForAutofill="noExcludeDescendants" textContentType="none" secureTextEntry contextMenuHidden={false}
              maxLength={1024} selectionColor={colors.pink} placeholderTextColor={colors.muted} style={s.input}
            /></View>
            <Button title={t('mobile.security.reveal')} disabled={busy || !password} onPress={reveal} />
            {busy && <ActivityIndicator accessibilityLabel={t('mobile.security.confirming')} color={colors.pink} />}
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
