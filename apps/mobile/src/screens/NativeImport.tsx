import type { TFunction } from 'i18next';
import { useNativeTranslation } from '../platform/localization';
import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { importedKeyIdentity, isUtxoAccountPrivateKey, normalizeImportedKey, normalizeUtxoImport, type NativeImportView } from '../custody/importedAccounts';
import { UTXO_IMPORT_LABELS, UTXO_IMPORT_TYPES, type UtxoImportAddressType } from '../core/utxoAddresses';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';

type Props = {
  imports: NativeImportView;
  contextRevision: number;
  catalogueRevision: number;
  networkLabel: string;
  utxo: boolean;
  utxoAddressTypes?: readonly UtxoImportAddressType[];
  onImported(): void;
  onBack(): void;
  onSubmitStart(): void;
  onSubmitEnd(): void;
};


function failure(cause: unknown, t: TFunction, invalidInput = t('mobile.importAccount.invalidInput')): string {
  const code = cause instanceof Error ? cause.message : '';
  if (code === 'DUPLICATE_ACCOUNT') return t('mobile.importAccount.duplicate');
  if (code === 'ACCOUNT_LIMIT') return t('mobile.importAccount.limit');
  if (code === 'INVALID_INPUT' || code === 'IMPORTED_KEY_INVALID') return invalidInput;
  if (code === 'BUSY') return t('mobile.importAccount.busy');
  if (code === 'INVALID_CREDENTIAL') return t('mobile.accounts.invalidCredential');
  if (code === 'AUTH_THROTTLED') return t('mobile.accounts.throttled');
  if (code === 'CANCELLED' || code === 'NOT_READY') return t('mobile.importAccount.contextChanged');
  return t('mobile.importAccount.failed');
}

/** Secrets remain inside this protected form and its private submit call. */
export function NativeImport({ imports, contextRevision, catalogueRevision, networkLabel, utxo, utxoAddressTypes = UTXO_IMPORT_TYPES, onImported, onBack, onSubmitStart, onSubmitEnd }: Props) {
  const { t } = useNativeTranslation();
  const [privateKey, setPrivateKey] = useState('');
  const [utxoAddressType, setUtxoAddressType] = useState<UtxoImportAddressType>('p2wpkh');
  const [name, setName] = useState('');
  const [address, setAddress] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const extended = utxo && isUtxoAccountPrivateKey(privateKey.trim());
  const wifOptions = utxo && !extended ? { utxoAddressType } : {};
  const scope = useRef(Object.freeze({ contextRevision, catalogueRevision }));
  const lifetime = useRef<{ mounted: boolean; request: number; working: boolean; abort: AbortController | null; authentication: NativePrivateAuthenticationScope | null }>({ mounted: false, request: 0, working: false, abort: null, authentication: null });
  const latestBack = useRef(onBack);
  const clear = useCallback(() => {
    lifetime.current.request++;
    lifetime.current.authentication?.retire(); lifetime.current.abort?.abort();
    setPrivateKey(''); setAddress(null); setAcknowledged(false); setError('');
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
    const interrupt = (value: string) => {
      if (value !== 'active' && !(state.authentication && allowsPrivateAuthenticationInterruption(state.authentication, value))) clear();
    };
    const change = AppState.addEventListener('change', interrupt);
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => interrupt('blur')) : null;
    return () => {
      state.mounted = false; state.request++;
      state.authentication?.retire(); state.abort?.abort();
      imports.cancel(); hardware.remove(); change.remove(); blur?.remove();
    };
  }, [back, clear, imports]);

  const review = async () => {
    const state = lifetime.current;
    if (!state.mounted || state.working || AppState.currentState !== 'active') return;
    setError('');
    if (!name.trim() || name.trim().length > 64 || !name.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
      setError(t('mobile.importAccount.invalidName')); return;
    }
    const request = ++state.request;
    const check = () => {
      if (!state.mounted || state.request !== request || AppState.currentState !== 'active')
        throw new Error('CANCELLED');
    };
    state.working = true;
    setBusy(true);
    try {
      const draft = utxo ? normalizeUtxoImport({ privateKey, ...wifOptions }) : undefined;
      const key = draft?.privateKey ?? normalizeImportedKey(privateKey);
      const reviewed = draft
        ? await imports.previewUtxo(draft, scope.current.contextRevision, scope.current.catalogueRevision, check)
        : importedKeyIdentity(key, 0).address;
      check();
      setPrivateKey(key); setAddress(reviewed); setAcknowledged(false);
      Keyboard.dismiss();
    } catch (cause) {
      if (state.mounted && state.request === request)
        setError(utxo ? failure(cause, t, t('mobile.importAccount.invalidUtxo')) :
          t('mobile.importAccount.invalidEvm'));
    } finally {
      state.working = false;
      if (state.mounted) setBusy(false);
    }
  };
  const submit = async () => {
    const state = lifetime.current;
    if (!state.mounted || state.working || !privateKey || !address || !acknowledged || AppState.currentState !== 'active') return;
    state.working = true; setBusy(true); setError('');
    const request = ++state.request;
    const input = { privateKey, label: name.trim(), expectedAddress: address, ...wifOptions };
    const authentication = createNativePrivateAuthenticationScope(), abort = new AbortController();
    state.authentication = authentication; state.abort = abort;
    setPrivateKey(''); Keyboard.dismiss();
    try {
      onSubmitStart();
      await imports.submit(input, scope.current.contextRevision, scope.current.catalogueRevision, abort.signal, authentication);
      if (state.mounted && state.request === request && AppState.currentState === 'active') onImported();
    } catch (cause) {
      if (state.mounted && state.request === request) {
        setAddress(null); setAcknowledged(false); setError(failure(cause, t));
      }
      // Authenticated mutation failures publish the authority's typed feedback
      // themselves; an unmounted form must not replace a newer request's error.
    } finally {
      authentication.retire(); abort.abort();
      if (state.authentication === authentication) state.authentication = null;
      if (state.abort === abort) state.abort = null;
      state.working = false;
      onSubmitEnd();
      if (state.mounted) setBusy(false);
    }
  };

  return <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen gap={16} footer={address ? <Button title={t('mobile.importAccount.import')} disabled={busy || !acknowledged} onPress={submit} /> :
        <Button title={t('mobile.importAccount.review')} disabled={busy || !privateKey || !name.trim()} onPress={() => void review()} />}>
        <Header title={address ? t('mobile.importAccount.reviewTitle') : t('mobile.accounts.importKey')} subtitle={utxo ? networkLabel : t('mobile.importAccount.evmAccount', { network: networkLabel })} onBack={back} />
        {!utxo && <Notice title={t('mobile.importAccount.separateTitle')} body={t('mobile.importAccount.separateBody')} tone="amber" />}
        {address ? <>
          <Card style={s.identity}><Text style={s.label}>{name.trim()}</Text><Text style={s.address}>{address}</Text></Card>
          <Text style={styles.muted}>{utxo
            ? t('mobile.importAccount.checkUtxo', { addressType: UTXO_IMPORT_LABELS[extended ? 'p2wpkh' : utxoAddressType], network: networkLabel })
            : t('mobile.importAccount.checkEvm')}</Text>
          {utxo && <Notice title={t('mobile.importAccount.backupTitle')} body={t('mobile.importAccount.backupBody')} tone="amber" />}
          <IdlePressable accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged, disabled: busy }} aria-checked={acknowledged} accessibilityLabel={t('mobile.importAccount.backupAcknowledgement')}
            disabled={busy} onPress={() => setAcknowledged((value) => !value)} style={s.checkRow}>
            <View style={[s.checkbox, acknowledged && s.checked]}><Text style={s.checkmark}>{acknowledged ? '✓' : ''}</Text></View>
            <Text style={s.checkLabel}>{t('mobile.importAccount.backupAcknowledgementBody')}</Text>
          </IdlePressable>
          {!busy && <Button title={t('mobile.importAccount.editKey')} variant="secondary" onPress={() => { setAddress(null); setAcknowledged(false); setError(''); }} />}
        </> : <>
          <View style={s.field}><Text style={s.label}>{t('mobile.accounts.accountName')}</Text><IdleTextInput accessibilityLabel={t('mobile.accounts.accountName')} value={name} onChangeText={setName}
            editable={!busy} maxLength={64} autoCorrect={false} autoComplete="off" style={s.input} /></View>
          <View style={s.field}><Text style={s.label}>{utxo ? t('mobile.importAccount.utxoKey') : t('mobile.importAccount.evmKey')}</Text><IdleTextInput accessibilityLabel={utxo ? t('mobile.importAccount.utxoKey') : t('mobile.importAccount.evmKey')} value={privateKey} onChangeText={setPrivateKey}
            editable={!busy} secureTextEntry maxLength={utxo ? 128 : 1024} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
            textContentType="none" importantForAutofill="noExcludeDescendants" style={s.input} /></View>
          {utxo && !extended && <View style={s.field}>
            <Text style={s.label}>{t('mobile.importAccount.addressType')}</Text>
            <View style={s.addressTypes}>{utxoAddressTypes.map((type) => (
              <IdlePressable key={type} accessibilityRole="radio" accessibilityState={{ checked: type === utxoAddressType, disabled: busy }}
                aria-checked={type === utxoAddressType} disabled={busy} onPress={() => setUtxoAddressType(type)}
                style={[s.addressOption, type === utxoAddressType && s.selectedAddressOption]}>
                <Text style={[s.label, type === utxoAddressType && s.selectedAddressLabel]}>{UTXO_IMPORT_LABELS[type]}</Text>
              </IdlePressable>
            ))}</View>
          </View>}
          <Text style={styles.muted}>{utxo
            ? t('mobile.importAccount.utxoHint')
            : t('mobile.importAccount.evmHint')}</Text>
        </>}
        {busy && <ActivityIndicator accessibilityLabel={address ? t('mobile.importAccount.importing') : t('mobile.importAccount.checking')} color={colors.pink} />}
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        {typeof __DEV__ !== 'undefined' && __DEV__ && <Text style={s.buildLabel}>{t('mobile.common.development')}</Text>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  field: { gap: 10 },
  addressTypes: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  addressOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 14 },
  selectedAddressOption: { borderColor: colors.pink, backgroundColor: colors.raised },
  selectedAddressLabel: { color: colors.text },
  label: { color: colors.muted, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 52, fontSize: 16 },
  identity: { padding: 18, gap: 10 }, address: { fontSize: 14, lineHeight: 23 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  checkbox: { width: 24, height: 24, borderColor: colors.muted, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.pink, borderColor: colors.pink }, checkmark: { color: colors.bg, fontWeight: '700' },
  checkLabel: { flex: 1, lineHeight: 22 }, error: { color: colors.red, fontSize: 14, lineHeight: 21 },
  buildLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
