import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeConnectionsView, NativeTransactionReview } from '../connections/types';
import { formatBaseUnits } from '../core/amounts';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';
import { IdlePressable } from './IdleActivityBoundary';
import { ApprovalReview } from './ApprovalReview';

const reviewErrors = {
  INVALID_MESSAGE: 'The app sent an invalid request.',
  SIGNER_MISMATCH: 'The app is requesting a different account.',
  SUSPICIOUS_SIGN_IN: 'The request does not match the connected website.',
  INVALID_TYPED_DATA: 'The app sent invalid request data.',
  BLOCKED_SITE: 'This website is on a known phishing list.',
  SITE_MISMATCH: 'The requesting website does not match the app’s claimed address.',
  INVALID_TRANSACTION: 'The app sent an invalid transaction.',
  TRANSACTION_UNAVAILABLE: 'This transaction could not be prepared. Request it again from the app.',
  DELIVERY_UNCERTAIN: 'The result could not be confirmed. Check Activity before trying again.',
} as const;

export function TransactionDetails({ transaction }: { transaction: object }) {
  const [page, setPage] = useState(0);
  const payload = useMemo(() => JSON.stringify(transaction, null, 2), [transaction]);
  const pageSize = 2048;
  const pages = Math.ceil(payload.length / pageSize);
  return <Card style={s.card}>
    <Text accessibilityRole="header" style={s.sectionTitle}>Transaction details</Text>
    <Text selectable style={s.payload}>{payload.slice(page * pageSize, (page + 1) * pageSize)}</Text>
    {pages > 1 && <>
      <Text style={s.muted}>Page {page + 1} of {pages}</Text>
      <View style={s.pagination}>
        <Button title="Previous page" variant="quiet" disabled={page === 0}
          onPress={() => setPage(page - 1)} style={s.pageButton} />
        <Button title="Next page" variant="quiet" disabled={page + 1 === pages}
          onPress={() => setPage(page + 1)} style={s.pageButton} />
      </View>
    </>}
  </Card>;
}

/** The review receives public values and sends only bound identifiers to custody. */
export function NativeTransactionReviewScreen({ review, controller }: {
  review: NativeTransactionReview;
  controller: NativeConnectionsView;
}) {
  const [acceptedRevision, setAcceptedRevision] = useState<number | null>(null);
  const [detailsRevision, setDetailsRevision] = useState<number | null>(null);
  const [approvalDraft, setApprovalDraft] = useState<{ id: string; transaction: NativeTransactionReview['transaction'] } | null>(null);
  const approvalDraftRef = useRef(approvalDraft);
  const editingApproval = approvalDraft?.id === review.id && approvalDraft.transaction === review.transaction;
  const setApprovalEditing = (editing: boolean) => {
    const current = controller.getSnapshot().signingReview;
    if (current?.kind !== 'transaction' || current.id !== review.id || current.transaction !== review.transaction) return;
    const previous = approvalDraftRef.current;
    if (!editing && (previous?.id !== review.id || previous.transaction !== review.transaction)) return;
    const next = editing ? { id: review.id, transaction: review.transaction } : null;
    approvalDraftRef.current = next;
    setApprovalDraft(next);
  };
  const acknowledged = acceptedRevision === review.revision;
  const detailsVisible = detailsRevision === review.revision;
  const submitted = review.broadcastHash !== null || review.dispatched;
  const close = () => { void controller.rejectRequest(review.id).catch(() => undefined); };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void controller.rejectRequest(review.id).catch(() => undefined);
      return true;
    });
    return () => subscription.remove();
  }, [controller, review.id]);

  const transaction = review.transaction;
  const prepared = transaction !== null && review.maximumFeeUnits !== null && review.maximumTotalUnits !== null;
  const approve = () => {
    if (approvalDraftRef.current?.id === review.id && approvalDraftRef.current.transaction === review.transaction) return;
    const action = review.needsAccountSwitch
      ? controller.activateRequestAccount(review.id, review.revision)
      : controller.approveRequest(review.id, review.revision, acknowledged);
    void action.catch(() => undefined);
  };
  const showError = review.error && review.error !== 'SITE_MISMATCH' &&
    !(review.error === 'BLOCKED_SITE' && review.verification.isScam);
  const amount = (units: string) => `${formatBaseUnits(units, review.decimals)} ${review.symbol}`;

  return <SafeAreaView edges={['top']} style={s.container}><KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Screen>
    <Header title="Review transaction" onBack={close} />
    <Card style={s.card}>
      <Text style={s.appName}>{review.appName}</Text>
      <Text selectable style={s.origin}>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      <View style={s.divider} />
      <Text style={s.account}>{review.accountLabel}</Text>
      <Text selectable style={s.address}>{review.address}</Text>
      <Text style={s.muted}>{review.networkLabel} · Chain ID {review.chainId}</Text>
    </Card>
    {review.approval && transaction && <ApprovalReview summary={review.approval} transaction={transaction}
      onEditingChange={setApprovalEditing}
      disabled={review.busy || submitted || review.needsAccountSwitch || review.error !== null}
      edit={(value) => controller.editApprovalAmount(review.id, review.revision, value)} />}
    {transaction && <Card style={s.card}>
      <Text style={s.label}>{transaction.to === null ? 'Contract deployment' : transaction.data === '0x' ? 'Send' : 'Contract interaction'}</Text>
      <Text selectable style={s.amount}>{amount(transaction.value)}</Text>
      <Text style={s.label}>{transaction.to === null ? 'Destination' : 'To'}</Text>
      <Text selectable style={s.address}>{transaction.to ?? 'New contract'}</Text>
      <View style={s.divider} />
      <Text style={s.label}>Maximum network fee</Text>
      <Text selectable style={s.account}>{review.maximumFeeUnits === null ? 'Calculating…' : amount(review.maximumFeeUnits)}</Text>
      <Text style={s.label}>Maximum total</Text>
      <Text selectable style={s.account}>{review.maximumTotalUnits === null ? 'Calculating…' : amount(review.maximumTotalUnits)}</Text>
      <Button title={detailsVisible ? 'Hide transaction details' : 'View transaction details'} variant="quiet"
        expanded={detailsVisible} onPress={() => setDetailsRevision(detailsVisible ? null : review.revision)} />
    </Card>}
    {transaction && detailsVisible && <TransactionDetails key={`${review.id}:${review.revision}`} transaction={transaction} />}
    {review.advisories.length > 0 && <Card style={s.card}>
      <Text accessibilityRole="header" style={s.sectionTitle}>Check these addresses</Text>
      {review.advisories.map((advisory, index) => <View key={`${advisory.field}-${index}`} style={s.advisory}>
        <Text style={s.account}>{advisory.field}</Text>
        <Text selectable style={s.address}>{advisory.address}</Text>
        <Text style={s.warning}>{advisory.reason ?? 'This address appears on a known unsafe-address list.'}</Text>
      </View>)}
      {review.requiresWarningAcknowledgement && !review.needsAccountSwitch && !submitted &&
        <IdlePressable accessibilityRole="checkbox" accessibilityLabel="I understand the address warning"
          accessibilityState={{ checked: acknowledged, disabled: review.busy }} disabled={review.busy}
          onPress={() => setAcceptedRevision(acknowledged ? null : review.revision)} style={s.acknowledgement}>
          <View style={[s.checkbox, acknowledged && s.checked]}><Text style={s.checkmark}>{acknowledged ? '✓' : ''}</Text></View>
          <Text style={s.acknowledgementText}>I understand the address warning.</Text>
        </IdlePressable>}
    </Card>}
    {review.broadcastHash && <Card style={s.card}>
      <Text style={s.label}>Transaction ID</Text>
      <Text selectable style={s.address}>{review.broadcastHash}</Text>
    </Card>}
    {showError && review.error && <Notice title={submitted ? 'Check transaction status' : 'Transaction unavailable'} body={reviewErrors[review.error]} />}
    {review.needsAccountSwitch && !review.error && !submitted &&
      <Text style={s.muted}>Switch to {review.accountLabel} to review this transaction.</Text>}
    {review.busy && <View style={s.progress}><ActivityIndicator color={colors.blue} />
      <Text>{submitted ? 'Sending transaction…' : transaction ? 'Please wait…' : 'Preparing transaction…'}</Text></View>}
    {!submitted && <Button title={review.needsAccountSwitch ? 'Switch account' : 'Confirm transaction'}
      disabled={editingApproval || review.error !== null || review.busy || !review.needsAccountSwitch &&
        (!prepared || review.requiresWarningAcknowledgement && !acknowledged)} onPress={approve} />}
    <Button title={submitted ? 'Close' : 'Reject'} variant="quiet" onPress={close} />
  </Screen></KeyboardAvoidingView></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 10, padding: 20 },
  appName: { fontSize: 22, lineHeight: 29, fontWeight: '700' },
  origin: { fontSize: 16, lineHeight: 23, color: colors.blue },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
  account: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  amount: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted },
  address: { fontSize: 13, lineHeight: 20, color: colors.muted },
  muted: { fontSize: 14, lineHeight: 22, color: colors.muted },
  sectionTitle: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  payload: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 19 },
  pagination: { flexDirection: 'row', gap: 8 },
  pageButton: { flex: 1 },
  advisory: { gap: 6 },
  warning: { fontSize: 14, lineHeight: 21, color: colors.amber },
  acknowledgement: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 48 },
  acknowledgementText: { flex: 1, fontSize: 14, lineHeight: 21 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.blue, borderColor: colors.blue },
  checkmark: { color: colors.bg, fontWeight: '700' },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
});
