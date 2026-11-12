import { useNativeTranslation } from '../platform/localization';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeConnectionsView, NativeMessageReview } from '../connections/types';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { DappSiteStatus } from './DappSiteStatus';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { useDappLedgerConnection } from './useDappLedgerConnection';

/** Public review data and identifier-only commands keep the signer inside custody. */
export function NativeMessageReviewScreen({ review, controller, ledgerConnection }: {
  review: NativeMessageReview;
  controller: NativeConnectionsView;
  ledgerConnection?: NativeLedgerConnectionView;
}) {
  const { t } = useNativeTranslation();
  const reviewErrors = {
    INVALID_MESSAGE: t('mobile.dappConsent.messageReview.theAppSentAnInvalidSigningMessage'),
    SIGNER_MISMATCH: t('mobile.dappConsent.messageReview.theAppIsAskingForASignature'),
    SUSPICIOUS_SIGN_IN: t('mobile.dappConsent.messageReview.theRequestingAppAndTheSignIn'),
    INVALID_TYPED_DATA: t('mobile.dappConsent.messageReview.theAppSentInvalidTypedData'),
    BLOCKED_SITE: t('mobile.dappConsent.messageReview.thisWebsiteIsOnAKnownPhishing'),
    SITE_MISMATCH: t('mobile.dappConsent.messageReview.theRequestingWebsiteDoesNotMatchThe'),
    DELIVERY_UNCERTAIN: t('mobile.dappConsent.messageReview.theSignatureWasHandedToWalletconnectDelivery'),
    INVALID_TRANSACTION: t('mobile.dappConsent.messageReview.theAppSentAnInvalidRequest'),
    TRANSACTION_UNAVAILABLE: t('mobile.dappConsent.messageReview.thisRequestCouldNotBePrepared'),
  } as const;

  const orderWarnings = {
    'send.nftOrderZeroPayment': t('mobile.dappConsent.messageReview.thisOrderListsNoTokenPaymentTo'),
    'send.nftOrderNoReturn': t('mobile.dappConsent.messageReview.thisOrderListsNoAssetsPayableTo'),
  } as const;

  const ledger = useDappLedgerConnection({ review, controller, ledgerConnection });
  const [acceptance, setAcceptance] = useState<{ revision: number; checked: boolean } | null>(null);
  const acknowledged = acceptance?.revision === review.revision && acceptance.checked;
  const reject = () => { void controller.rejectRequest(review.id).catch(() => undefined); };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void controller.rejectRequest(review.id).catch(() => undefined);
      return true;
    });
    return () => subscription.remove();
  }, [controller, review.id]);

  const personal = review.method === 'personal_sign';
  const blocked = review.error !== null;
  const showError = review.error !== null && review.error !== 'SITE_MISMATCH' &&
    !(review.error === 'BLOCKED_SITE' && review.verification.isScam);
  const perform = () => {
    if (!review.needsAccountSwitch && !ledger.canApprove()) return;
    const action = review.needsAccountSwitch
      ? controller.activateRequestAccount(review.id, review.revision)
      : controller.approveRequest(review.id, review.revision, acknowledged);
    void action.catch(() => undefined);
  };

  return <SafeAreaView edges={['top', 'bottom']} style={s.container}><Screen footer={<>
    {ledger.showConnect && <Button title={t('mobile.accounts.connectLedger')} variant="secondary" onPress={ledger.connect} />}
    <View style={s.actions}>
      <Button title={review.dispatched ? t('buttons.close') : t('buttons.reject')} variant="secondary" style={s.action} onPress={reject} />
      {!review.dispatched && <Button title={review.busy ? t('mobile.dappConsent.messageReview.pleaseWait') : review.needsAccountSwitch ? t('mobile.dappConsent.messageReview.switchAccount') : personal ? t('mobile.dappConsent.messageReview.signMessage') : t('mobile.dappConsent.messageReview.signTypedData')}
        disabled={blocked || review.busy || !review.needsAccountSwitch && (ledger.blocked || review.requiresWarningAcknowledgement && !acknowledged)} onPress={perform} style={s.action} />}
    </View>
  </>}>
    <Header title={personal ? t('mobile.dappConsent.messageReview.signMessage') : t('mobile.dappConsent.messageReview.signTypedData')} onBack={reject} />
    <Card style={s.card}>
      <Text style={s.appName}>{review.appName}</Text>
      <Text style={s.label}>{t('mobile.connections.reportedWebsite')}</Text>
      <Text selectable style={s.origin}>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      <View style={s.divider} />
      <Text style={s.account}>{review.accountLabel}</Text>
      <Text selectable style={s.address}>{review.address}</Text>
      <Text style={s.network}>{t('mobile.connections.network', { network: review.networkLabel, chainId: review.chainId })}</Text>
      {review.smartAccount && <Text style={s.body}>{t('mobile.dappConsent.messageReview.smartAccountSignatureYourSmartAccountWill')}</Text>}
    </Card>
    {review.order && <Card style={s.card}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{t('mobile.dappConsent.messageReview.protocolOrder', { protocol: review.order.protocol })}</Text>
      <Text style={s.body}>{t('mobile.dappConsent.messageReview.signingThisOrderCanAuthorizeAssetTransfers')}</Text>
      {review.order.status === 'unrecognized' && <Text style={s.body}>{t('mobile.dappConsent.messageReview.paliCannotReliablySummarizeThisOrderFormat')}</Text>}
      {review.order.warnings.map((warning) => <Notice key={warning} title={t('send.nftOrderWarningTitle')}
        body={orderWarnings[warning]} />)}
    </Card>}
    {review.advisories.length > 0 && <Card style={s.card}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{t('mobile.dappConsent.messageReview.checkTheseAddresses')}</Text>
      {review.advisories.map((advisory, index) => <View key={`${advisory.field}-${index}`} style={s.advisory}>
        <Text style={s.account}>{advisory.field}</Text>
        <Text selectable style={s.address}>{advisory.address}</Text>
        <Text style={s.warning}>{advisory.reason ?? t('mobile.dappConsent.messageReview.thisAddressAppearsOnAKnownUnsafe')}</Text>
      </View>)}
      {review.requiresWarningAcknowledgement && !review.needsAccountSwitch && <IdlePressable accessibilityRole="checkbox"
        accessibilityLabel={t('mobile.dappConsent.messageReview.iUnderstandTheAddressWarning')} accessibilityState={{ checked: acknowledged, disabled: review.busy || review.dispatched }}
        disabled={review.busy || review.dispatched} onPress={() => setAcceptance({ revision: review.revision, checked: !acknowledged })} style={s.acknowledgement}>
        <View style={[s.checkbox, acknowledged && s.checked]}><Text style={s.checkmark}>{acknowledged ? '✓' : ''}</Text></View>
        <Text style={s.acknowledgementText}>{t('mobile.dappConsent.messageReview.iUnderstandTheAddressWarning1')}</Text>
      </IdlePressable>}
    </Card>}
    <Card style={s.card}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{personal ? t('send.message') : t('mobile.dappConsent.messageReview.signedData')}</Text>
      <Text selectable style={[s.payload, !personal && s.structured]}>{review.message ?? review.typedData ?? ''}</Text>
    </Card>
    {showError && review.error && <Notice title={t('mobile.dappConsent.messageReview.signingUnavailable')} body={reviewErrors[review.error]} />}
    {review.needsAccountSwitch && !blocked && <Text style={s.body}>{t('mobile.dappConsent.messageReview.switchToReviewSign', { account: review.accountLabel })}</Text>}
    {review.dispatched && review.busy && <View style={s.sending}><ActivityIndicator color={colors.blue} /><Text>{t('mobile.dappConsent.messageReview.sendingSignature')}</Text></View>}
  </Screen>{ledger.modal}</SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 10, padding: 20 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minWidth: 0 },
  appName: { fontSize: 22, lineHeight: 29, fontWeight: '700' },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted },
  origin: { fontSize: 16, lineHeight: 23, color: colors.blue },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
  account: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  address: { fontSize: 13, lineHeight: 20, color: colors.muted },
  network: { fontSize: 14, lineHeight: 21, color: colors.muted },
  sectionTitle: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 22, color: colors.muted },
  payload: { fontSize: 15, lineHeight: 23 },
  structured: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 21 },
  advisory: { gap: 6 },
  warning: { fontSize: 14, lineHeight: 21, color: colors.amber },
  acknowledgement: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 48 },
  acknowledgementText: { flex: 1, fontSize: 14, lineHeight: 21 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.blue, borderColor: colors.blue },
  checkmark: { color: colors.bg, fontWeight: '700' },
  sending: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
});
