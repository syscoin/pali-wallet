import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
import { BalancePrivacySetting } from './BalancePrivacySetting';
import { useNativeTranslation } from '../platform/localization';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { setStringAsync, StringFormat } from 'expo-clipboard';
import type { HdKeyExportFlow, HdKeyExportPresentation } from '../custody/hdKeyExport';
import { Button, Card, colors, Header, IconButton, Notice, Row, Screen, styles, Text } from '../ui';

type Props = {
  keyExport: HdKeyExportFlow;
  keyFormat: 'evm' | { kind: 'wif' | 'extended'; networkLabel: string; addressType: string } | null;
  accountId: string;
  accountType: 'HDAccount' | 'Imported' | 'SmartAccount' | 'Ledger' | 'Trezor';
  accountLabel: string;
  address: string;
  onViewRecovery(): void;
  onRemoveWallet?(): void;
  onRestoreAccess?(): void;
  onAutoLock?(): void;
  backupConfirmed: boolean;
  onLock(): void;
  onBack(): void;
  captureFailureHandler(): (error: unknown) => void;
};

/** Private presentation stays in this mounted, protected native screen only. */
export function NativeSecurity({ keyExport, keyFormat, accountId, accountType, accountLabel, address, onViewRecovery, onRemoveWallet, onRestoreAccess, onAutoLock, backupConfirmed, onLock, onBack, captureFailureHandler }: Props) {
  const { t } = useNativeTranslation();
  const [mode, setMode] = useState<'hub' | 'key' | 'recovery'>('hub');
  const [presentation, setPresentation] = useState<HdKeyExportPresentation | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const lifecycle = useRef({ mounted: false, operation: 0, request: 0, busy: false, copying: false });
  const visiblePresentation = useRef<HdKeyExportPresentation | null>(null);
  const latestBack = useRef<() => void>(() => undefined);
  const clear = useCallback(() => {
    lifecycle.current.operation++;
    lifecycle.current.copying = false; visiblePresentation.current = null;
    setPresentation(null); setCopying(false); setCopied(false); setError('');
    Keyboard.dismiss();
  }, []);
  useLayoutEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    const unsubscribe = keyExport.onClear(clear);
    const interrupted = (next: string) => {
      if (next === 'active' || allowsPrivateAuthenticationInterruption(keyExport, next)) return;
      state.request++; keyExport.cancel(); clear();
    };
    const app = AppState.addEventListener('change', interrupted);
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => interrupted('blur')) : null;
    return () => {
      state.mounted = false; state.operation++; state.request++;
      state.copying = false; visiblePresentation.current = null;
      unsubscribe(); app.remove(); blur?.remove(); keyExport.cancel();
    };
  }, [keyExport, clear, accountId, address]);
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
    if (!keyFormat || !state.mounted || state.busy || AppState.currentState !== 'active') return;
    state.busy = true; setBusy(true); setError('');
    Keyboard.dismiss();
    const request = ++state.request;
    const reportFailure = captureFailureHandler();
    // begin synchronously clears any previous presentation before its first await.
    const pending = keyExport.begin();
    const operation = state.operation;
    try {
      const shown = await pending;
      if (state.mounted && state.operation === operation && AppState.currentState === 'active' && keyExport.isCurrent(shown.id) &&
          shown.accountId === accountId && shown.address === address) setPresentation(shown);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      // The flow clears its own failed presentation before rejecting. Preserve
      // feedback only for this still-active request, never a departure or cancel.
      if (state.mounted && state.request === request && AppState.currentState === 'active' && code !== 'CANCELLED') {
        setError(t('mobile.security.revealFailed'));
      }
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
  useLayoutEffect(() => { visiblePresentation.current = shown; }, [shown]);
  const copyKey = async (value: HdKeyExportPresentation) => {
    const state = lifecycle.current, operation = state.operation;
    const current = () => state.mounted && state.operation === operation && AppState.currentState === 'active' &&
      visiblePresentation.current === value && value.accountId === accountId && value.address === address && keyExport.isCurrent(value.id);
    if (state.copying || state.busy || !current()) return;
    state.copying = true; setCopying(true); setCopied(false); setError('');
    try {
      const success = await setStringAsync(value.privateKey, {
        inputFormat: StringFormat.PLAIN_TEXT,
        android: { isSensitive: true },
        ios: { localOnly: true, expiresAt: new Date(Date.now() + 120000) },
      });
      if (!current()) return;
      if (!success) throw new Error('COPY_FAILED');
      setCopied(true);
    } catch {
      if (current()) setError(t('transactions.copyFailed'));
    } finally {
      if (state.mounted && state.operation === operation) { state.copying = false; setCopying(false); }
    }
  };
  const utxo = keyFormat !== 'evm' ? keyFormat : null;
  const backupStatus = backupConfirmed ? t('mobile.onboarding.backedUp') : t('mobile.onboarding.backupNeeded');

  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen gap={16} footer={mode === 'key' ? <Button title={shown ? t('mobile.security.hide') : t('mobile.security.reveal')} disabled={!shown && busy} onPress={shown ? hide : reveal} /> : mode === 'hub' ? <Button title={t('mobile.settings.lock')} variant="secondary" size="compact" icon="lock" onPress={() => { hide(); onLock(); }} /> : undefined}><Header title={mode === 'key' ? t('mobile.security.accountKey') : mode === 'recovery' ? t('mobile.security.recoveryGuide') : t('mobile.security.title')} onBack={back} />
        {mode === 'hub' ? <>
          <Card>{onRestoreAccess && <Row title={t('mobile.recoveryDevices.recovery.restoreSecureAccess')} subtitle={t('mobile.onboarding.restoreSecureDescription')} icon="key" onPress={() => { hide(); onRestoreAccess(); }} />}<Row title={accountType === 'Ledger' || accountType === 'Trezor' ? t('mobile.security.viewPaliPhrase') : t('mobile.security.viewPhrase')} subtitle={backupStatus} icon="shield" onPress={() => { hide(); onViewRecovery(); }} />
            {keyFormat && (accountType === 'HDAccount' || accountType === 'Imported') && <Row title={t('mobile.security.revealAccountKey')} subtitle={accountLabel} icon="eye" onPress={() => { hide(); setMode('key'); }} />}
            {onAutoLock && <Row title={t('mobile.viewLock.autoTitle')} subtitle={t('mobile.onboarding.autoWalletHint')} icon="lock" onPress={() => { hide(); onAutoLock(); }} />}
            <BalancePrivacySetting />
            <Row title={t('mobile.security.recoveryGuide')} subtitle={t('mobile.security.backupsRestore')} icon="help" onPress={() => { hide(); setMode('recovery'); }} last /></Card>
          {onRemoveWallet && <Button title={t('mobile.security.removeWallet')} variant="danger" size="compact" onPress={() => { hide(); onRemoveWallet(); }} />}
        </> : mode === 'recovery' ? <>
          <Text style={s.heading}>{t('mobile.security.keepPhraseOffline')}</Text>
          {(accountType === 'Ledger' || accountType === 'Trezor') && <Text style={styles.muted}>{t('mobile.security.hardwareGuide', { device: accountType })}</Text>}
          <Text style={styles.muted}>{t('mobile.security.phraseRestore')}</Text>
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
            <View style={s.secret}><Text selectable={false} style={s.key}>{shown.privateKey}</Text>
              <IconButton icon={copied ? 'check' : 'copy'} label={t(copied ? 'components.copied' : 'mobile.security.copyPrivateKey')}
                disabled={copying} onPress={() => copyKey(shown)} />
            </View>
            {copied && <Text accessibilityLiveRegion="polite" style={s.copied}>{t('components.copied')}</Text>}
            <Text style={styles.muted}>{t('mobile.security.sessionOnly')}</Text>
          </> : <>
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
  secret: { padding: 20, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.amber, borderWidth: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  key: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 26, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  copied: { color: colors.blue, fontSize: 14, lineHeight: 20 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
