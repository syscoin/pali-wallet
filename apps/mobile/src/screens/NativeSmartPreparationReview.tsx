import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Platform, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSmartPreparationReview as Review } from '../connections/smartPreparationRequests';
import type { NativeConnectionsView } from '../connections/types';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';
import { NativeSmartAccountOperationContent } from './NativeSmartAccountOperation';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

type Controller = Pick<NativeConnectionsView, 'getSnapshot' | 'approveSmartPreparation' | 'confirmSmartPreparationPayer' | 'retrySmartPreparationMetadata' | 'rejectSmartPreparation' | 'isRequestAuthenticating'>;

/** Creation intent precedes account allocation; the existing operation review owns every signature and payer consent. */
export function NativeSmartPreparationReview({ review, controller }: { review: Review; controller: Controller }) {
  const { t } = useNativeTranslation();
  const requestId = review.id;
  const authentication = useMemo(() => ({ isAuthenticating: () => controller.isRequestAuthenticating(requestId) }), [controller, requestId]);
  const [acknowledged, setAcknowledged] = useState<string | null>(null), [expired, setExpired] = useState<string | null>(null);
  const live = useRef(false), current = useRef(review), busy = useRef<object | null>(null), acknowledgement = useRef<string | null>(null);
  useLayoutEffect(() => { current.current = review; }, [review]);
  const identity = JSON.stringify([review.id, review.expiresAt, review.label, review.chainId, review.requestedOwners, review.requestedThreshold]);
  const isCurrent = () => {
    const shown = controller.getSnapshot().preparationReview;
    return live.current && AppState.currentState === 'active' && Date.now() < review.expiresAt && current.current === review &&
      shown?.id === review.id && shown.revision === review.revision;
  };
  const reject = () => {
    if (!live.current || current.current.id !== review.id || current.current.expiresAt !== review.expiresAt) return;
    live.current = false; acknowledgement.current = null; setAcknowledged(null);
    void controller.rejectSmartPreparation(review.id).catch(() => undefined);
  };
  useEffect(() => {
    live.current = true; busy.current = null;
    const retire = () => { if (!live.current || current.current.id !== review.id || current.current.expiresAt !== review.expiresAt) return; live.current = false; acknowledgement.current = null; setAcknowledged(null); void controller.rejectSmartPreparation(review.id).catch(() => undefined); };
    const timer = setTimeout(() => { setExpired(review.id); retire(); }, Math.max(0, review.expiresAt - Date.now()));
    const change = AppState.addEventListener('change', state => { if (state !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, state)) retire(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { if (!allowsPrivateAuthenticationInterruption(authentication, 'blur')) retire(); }) : undefined;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { retire(); return true; });
    return () => { live.current = false; acknowledgement.current = null; clearTimeout(timer); change.remove(); blur?.remove(); back.remove(); };
  }, [controller, review.id, review.expiresAt, authentication]);
  const assent = acknowledged === identity;
  const blocked = review.busy || expired === review.id;
  const approve = () => {
    const accepted = acknowledgement.current === identity;
    if (!isCurrent() || blocked || busy.current || review.error && !review.canRetry || !review.operation && review.externalOwners.length > 0 && !accepted) return;
    const token = {}; busy.current = token;
    void controller.approveSmartPreparation(review.id, review.revision, accepted).catch(() => undefined).finally(() => { if (busy.current === token) busy.current = null; });
  };
  const site = <Card style={s.card}>
    <Text>{review.appName}</Text><Text style={s.muted}>{t('mobile.connections.reportedWebsite')}</Text><Text selectable style={s.address}>{review.origin}</Text>
    <DappSiteStatus verification={review.verification} />
    <Text>{review.networkLabel}</Text><Text>{t('connections.prepareSmartAccountNetwork', { chainId: review.chainId })}</Text>
  </Card>;
  const error = review.error && <Notice title={t(review.error === 'DELIVERY_UNCERTAIN' ? 'mobile.connections.psbt.deliveryTitle' : 'settings.unavailable')}
    body={t(review.error === 'BLOCKED_SITE' ? 'mobile.connections.blocked' : review.error === 'DELIVERY_UNCERTAIN' ? 'mobile.connections.psbt.deliveryBody' : 'connections.smartAccountPrepareFailed')} tone="amber" />;
  const retry = review.canRetry && <Button title={t('settings.smartAccountMetadataRetry')} disabled={blocked} onPress={approve} />;
  if (review.operation) return <NativeSmartAccountOperationContent authentication={authentication} state={review.operation} onBack={reject} disabled={blocked && review.operation.phase === 'authorize' || !!review.error}
    authorize={() => approve()}
    confirmPayer={payerId => { if (isCurrent()) void controller.confirmSmartPreparationPayer(review.id, review.revision, payerId).catch(() => undefined); }}
    retryMetadata={() => { if (isCurrent() && !blocked) void controller.retrySmartPreparationMetadata(review.id, review.revision).catch(() => undefined); }}
    before={<>{site}{error}{retry}</>} />;
  const authenticator = t(review.requestedAuthenticatorId === 'ecdsa' ? 'settings.ecdsaAuthenticator' : review.requestedAuthenticatorId === 'p256-webauthn' ? 'settings.passkeyAuthenticator' : review.requestedAuthenticatorId === 'slh-dsa' ? 'settings.slhDsaAuthenticator' : 'settings.unavailable');
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}><Screen key={review.id} footer={<>
    <Button title={t(review.canRetry ? 'settings.smartAccountMetadataRetry' : 'buttons.confirm')} disabled={blocked || !!review.error && !review.canRetry || !!review.externalOwners.length && !assent} onPress={approve} />
    <Button title={t('buttons.reject')} variant="secondary" onPress={reject} />
  </>}>
    <Header title={t('connections.prepareSmartAccountTitle')} onBack={reject} />
    {site}
    <Card style={s.card}>
      <Text>{t('connections.prepareSmartAccountDescription')}</Text><Text>{review.label}</Text>
      <Text>{t('connections.prepareSmartAccountAuthenticator', { authenticator })}</Text>
      {review.requestedOwners.map(owner => <Text key={owner} selectable style={s.address}>{owner}</Text>)}
      {review.requestedThreshold !== null && <Text>{t('smartAccountHub.compositeThreshold')} · {review.requestedThreshold}</Text>}
      {review.accountAddress && <Text selectable style={s.address}>{review.accountAddress}</Text>}
    </Card>
    {!!review.externalOwners.length && <Card style={s.card}>
      <Notice title={t('settings.ecdsaAuthenticator')} body={t('connections.prepareSmartAccountExternalEcdsaWarning')} tone="amber" />
      {review.externalOwners.map(owner => <Text key={owner} selectable style={s.address}>{owner}</Text>)}
      <View style={s.choice}><Text style={s.choiceText}>{t('connections.prepareSmartAccountExternalEcdsaConfirm')}</Text>
        <Switch accessibilityLabel={t('connections.prepareSmartAccountExternalEcdsaConfirm')} value={assent} disabled={blocked || !!review.error && !review.canRetry} onValueChange={value => { if (isCurrent() && !blocked) { acknowledgement.current = value ? identity : null; setAcknowledged(acknowledgement.current); } }} />
      </View>
    </Card>}
    {error}
    {review.busy && <ActivityIndicator color={colors.pink} accessibilityLabel={t('buttons.loading')} />}

  </Screen></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 12 }, muted: { color: colors.muted }, address: { fontFamily: 'monospace', fontSize: 12, color: colors.muted }, choice: { flexDirection: 'row', alignItems: 'center', gap: 12 }, choiceText: { flex: 1 } });
