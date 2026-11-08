import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeConnectionsView, NativeMessageReview } from '../connections/types';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { DappSiteStatus } from './DappSiteStatus';

const reviewErrors = {
  INVALID_MESSAGE: 'The app sent an invalid signing message.',
  SIGNER_MISMATCH: 'The app is asking for a signature from a different account.',
  SUSPICIOUS_SIGN_IN: 'The requesting app and the sign-in message name different websites.',
  INVALID_TYPED_DATA: 'The app sent invalid typed data.',
  BLOCKED_SITE: 'This website is on a known phishing list.',
  SITE_MISMATCH: 'The requesting website does not match the app’s claimed address.',
  DELIVERY_UNCERTAIN: 'The signature was handed to WalletConnect. Delivery could not be confirmed. Check the requesting app before trying again.',
  INVALID_TRANSACTION: 'The app sent an invalid request.',
  TRANSACTION_UNAVAILABLE: 'This request could not be prepared.',
} as const;

const orderWarnings = {
  'send.nftOrderZeroPayment': 'This order lists no token payment to its creator for the NFT. Only proceed if those terms are intended.',
  'send.nftOrderNoReturn': 'This order lists no assets payable to its creator in return. Only proceed if those terms are intended.',
} as const;

/** Public review data and identifier-only commands keep the signer inside custody. */
export function NativeMessageReviewScreen({ review, controller }: {
  review: NativeMessageReview;
  controller: NativeConnectionsView;
}) {
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
    const action = review.needsAccountSwitch
      ? controller.activateRequestAccount(review.id, review.revision)
      : controller.approveRequest(review.id, review.revision, acknowledged);
    void action.catch(() => undefined);
  };

  return <SafeAreaView edges={['top']} style={s.container}><Screen>
    <Header title={personal ? 'Sign message' : 'Sign typed data'} onBack={reject} />
    <Card style={s.card}>
      <Text style={s.appName}>{review.appName}</Text>
      <Text style={s.label}>Reported website</Text>
      <Text selectable style={s.origin}>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      <View style={s.divider} />
      <Text style={s.account}>{review.accountLabel}</Text>
      <Text selectable style={s.address}>{review.address}</Text>
      <Text style={s.network}>{review.networkLabel} · Chain ID {review.chainId}</Text>
    </Card>
    {review.order && <Card style={s.card}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{review.order.protocol} order</Text>
      <Text style={s.body}>Signing this order can authorize asset transfers when it is filled.</Text>
      {review.order.status === 'unrecognized' && <Text style={s.body}>Pali cannot reliably summarize this order format. Review the full signed data below.</Text>}
      {review.order.warnings.map((warning) => <Notice key={warning} title="Check the order terms"
        body={orderWarnings[warning]} />)}
    </Card>}
    {review.advisories.length > 0 && <Card style={s.card}>
      <Text accessibilityRole="header" style={s.sectionTitle}>Check these addresses</Text>
      {review.advisories.map((advisory, index) => <View key={`${advisory.field}-${index}`} style={s.advisory}>
        <Text style={s.account}>{advisory.field}</Text>
        <Text selectable style={s.address}>{advisory.address}</Text>
        <Text style={s.warning}>{advisory.reason ?? 'This address appears on a known unsafe-address list.'}</Text>
      </View>)}
      {review.requiresWarningAcknowledgement && !review.needsAccountSwitch && <IdlePressable accessibilityRole="checkbox"
        accessibilityLabel="I understand the address warning" accessibilityState={{ checked: acknowledged, disabled: review.busy || review.dispatched }}
        disabled={review.busy || review.dispatched} onPress={() => setAcceptance({ revision: review.revision, checked: !acknowledged })} style={s.acknowledgement}>
        <View style={[s.checkbox, acknowledged && s.checked]}><Text style={s.checkmark}>{acknowledged ? '✓' : ''}</Text></View>
        <Text style={s.acknowledgementText}>I understand the address warning.</Text>
      </IdlePressable>}
    </Card>}
    <Card style={s.card}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{personal ? 'Message' : 'Signed data'}</Text>
      <Text selectable style={[s.payload, !personal && s.structured]}>{review.message ?? review.typedData ?? ''}</Text>
    </Card>
    {showError && review.error && <Notice title="Signing unavailable" body={reviewErrors[review.error]} />}
    {review.needsAccountSwitch && !blocked && <Text style={s.body}>Switch to {review.accountLabel} to review and sign this request.</Text>}
    {review.dispatched && review.busy && <View style={s.sending}><ActivityIndicator color={colors.blue} /><Text>Sending signature…</Text></View>}
    {!review.dispatched && <Button title={review.busy ? 'Please wait…' : review.needsAccountSwitch ? 'Switch account' : personal ? 'Sign message' : 'Sign typed data'}
      disabled={blocked || review.busy || !review.needsAccountSwitch && review.requiresWarningAcknowledgement && !acknowledged} onPress={perform} />
    }
    <Button title={review.dispatched ? 'Close' : 'Reject'} variant="quiet" onPress={reject} />
  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 10, padding: 20 },
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
