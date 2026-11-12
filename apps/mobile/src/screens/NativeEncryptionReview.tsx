import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useNativeTranslation } from '../platform/localization';
import type { NativeConnectionsView, NativeEncryptionReview } from '../connections/types';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

/** Plaintext belongs only to this protected presentation, never the queue DTO. */
export function NativeEncryptionReviewScreen({ review, controller }: {
  review: NativeEncryptionReview;
  controller: NativeConnectionsView;
}) {
  const { t } = useNativeTranslation();
  const requestId = review.id;
  const authentication = useMemo(() => ({ isAuthenticating: () => controller.isRequestAuthenticating(requestId) }), [controller, requestId]);
  const focused = useRef(true);
  const [preview, setPreview] = useState<string | null>(null);
  const previewGeneration = useRef(0), shownPreviewGeneration = previewGeneration.current;
  const clearPreview = useCallback(() => { previewGeneration.current++; setPreview(null); }, []);
  const [error, setError] = useState<string | null>(null);
  const scope = JSON.stringify([review.id, review.address, review.networkLabel, review.chainId, review.needsAccountSwitch, review.error, review.method, review.ciphertext, review.expiresAt]);
  const owner = useRef({ scope, active: true, sequence: 0 });
  useLayoutEffect(() => {
    if (owner.current.scope !== scope) {
      owner.current = { scope, active: true, sequence: owner.current.sequence + 1 };
      clearPreview();
      setError(null);
    }
  }, [scope, clearPreview]);
  const [previewScope, setPreviewScope] = useState(scope);
  const reject = () => { if (owner.current.scope !== scope) return; owner.current.active = false; owner.current.sequence++; clearPreview(); void controller.rejectRequest(review.id).catch(() => undefined); };
  useEffect(() => {
    const current = owner.current;
    current.active = true;
    const retire = () => { if (owner.current !== current) return; current.active = false; current.sequence++; clearPreview(); void controller.rejectRequest(review.id).catch(() => undefined); };
    const back = BackHandler.addEventListener('hardwareBackPress', () => { retire(); return true; });
    const state = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        clearPreview();
        if (!allowsPrivateAuthenticationInterruption(authentication, next)) retire();
      }
    });
    const blur = AppState.addEventListener('blur', () => {
      focused.current = false; clearPreview();
      if (!allowsPrivateAuthenticationInterruption(authentication, 'blur')) retire();
    });
    const focus = AppState.addEventListener('focus', () => { focused.current = true; });
    return () => { current.active = false; current.sequence++; back.remove(); state.remove(); blur.remove(); focus.remove(); };
  }, [controller, review.id, scope, authentication, clearPreview]);
  const perform = async (action: 'preview' | 'approve' | 'copy') => {
    const current = owner.current;
    if (!current.active || current.scope !== scope || AppState.currentState !== 'active' || !focused.current) return;
    if (action === 'copy' && (preview === null || previewScope !== scope || shownPreviewGeneration !== previewGeneration.current)) return;
    const sequence = ++current.sequence;
    const live = () => owner.current === current && current.active && current.scope === scope && current.sequence === sequence &&
      AppState.currentState === 'active' && focused.current;
    setError(null);
    try {
      if (action === 'copy') {
        if (await Clipboard.setStringAsync(preview!) === false) throw new Error(t('transactions.copyFailed'));
      } else if (action === 'preview') {
        const value = await controller.previewEncryption(review.id, review.revision);
        if (live()) { setPreviewScope(scope); setPreview(value); }
      } else {
        clearPreview();
        await (review.needsAccountSwitch ? controller.activateRequestAccount(review.id, review.revision) : controller.approveRequest(review.id, review.revision, false));
      }
    } catch (cause) { if (live()) setError(cause instanceof Error ? cause.message : t('transactions.decryptFailed')); }
  };
  const decrypt = review.method === 'eth_decrypt';
  const plaintext = previewScope === scope ? preview : null;
  return <SafeAreaView edges={['top', 'bottom']} style={s.container}><Screen footer={<>
    {!review.dispatched && <Button title={review.needsAccountSwitch ? t('connections.switchAccount') : t('buttons.confirm')} disabled={review.busy || !!review.error} onPress={() => { void perform('approve'); }} />}
    <Button title={t('buttons.cancel')} variant="secondary" onPress={reject} />
  </>}>
    <Header title={t(decrypt ? 'send.decrypt' : 'send.encryptKey')} onBack={reject} />
    <Card style={s.card}>
      <Text style={s.app}>{review.appName}</Text>
      <Text selectable style={s.origin}>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      <Text>{review.accountLabel}</Text>
      <Text selectable style={s.address}>{review.address}</Text>
      <Text style={s.context}>{t('mobile.connections.network', { network: review.networkLabel, chainId: review.chainId })}</Text>
      <Text>{review.appName} {t(decrypt ? 'transactions.wouldLikeTo' : 'transactions.wouldLikeYourPubEncryption')}</Text>
    </Card>
    {decrypt && <Card style={s.card}>
      <Text>{t('transactions.message')}</Text>
      {plaintext === null ? <>
        <Text selectable style={s.address}>{review.ciphertext && review.ciphertext.length > 100 ? `${review.ciphertext.slice(0, 50)}…${review.ciphertext.slice(-50)}` : review.ciphertext}</Text>
        <Button title={t('transactions.decryptMessage')} variant="secondary" disabled={review.busy || review.dispatched || !!review.error || review.needsAccountSwitch} onPress={() => { void perform('preview'); }} />
      </> : <>
        <Text selectable style={s.plaintext}>{plaintext}</Text>
        <Button title={t('transactions.copyMessage')} icon="copy" variant="secondary" onPress={() => { void perform('copy'); }} />
      </>}
    </Card>}
    {(error || review.error) && <Notice title={t(decrypt ? 'send.decrypt' : 'send.encryptKey')} body={error ?? t(review.error === 'BLOCKED_SITE' ? 'mobile.connections.blocked' : review.error === 'SITE_MISMATCH' ? 'mobile.connections.mismatch' : review.error === 'DELIVERY_UNCERTAIN' ? 'mobile.connections.deliveryUncertain' : 'mobile.connections.unavailable')} />}

  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 20, gap: 12 },
  app: { fontSize: 22, lineHeight: 29, fontWeight: '700' },
  origin: { fontSize: 16, lineHeight: 23, color: colors.blue },
  address: { fontSize: 13, lineHeight: 20, color: colors.muted },
  context: { fontSize: 14, lineHeight: 21, color: colors.muted },
  plaintext: { fontSize: 16, lineHeight: 24 },
});
