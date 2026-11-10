import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { useDappLedgerConnection } from './useDappLedgerConnection';
import type { EvmDappFeeChoice } from '../../../../source/shared/evmDappFeePolicy';
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
        <Button title="Previous page" icon="arrow-left" variant="secondary" size="compact" disabled={page === 0}
          onPress={() => setPage(page - 1)} style={s.pageButton} />
        <Button title="Next page" icon="arrow-right" variant="secondary" size="compact" disabled={page + 1 === pages}
          onPress={() => setPage(page + 1)} style={s.pageButton} />
      </View>
    </>}
  </Card>;
}

/** The review receives public values and sends only bound identifiers to custody. */
export function NativeTransactionReviewScreen({ review, controller, ledgerConnection }: {
  review: NativeTransactionReview;
  controller: NativeConnectionsView;
  ledgerConnection?: NativeLedgerConnectionView;
}) {
  const ledger = useDappLedgerConnection({ review, controller, ledgerConnection });
  const expiryKey = `${review.id}:${review.expiresAt}`;
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(
      () => setExpiredKey(expiryKey),
      Math.max(0, review.expiresAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [expiryKey, review.expiresAt]);
  const expired = expiredKey === expiryKey;
  const [acceptedRevision, setAcceptedRevision] = useState<number | null>(null);
  const [detailsRevision, setDetailsRevision] = useState<number | null>(null);
  const [expandedCalls, setExpandedCalls] = useState<string | null>(null);
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
  const batch = review.batch;
  const callsKey = `${review.id}:${batch?.index}`;
  const callsVisible = expandedCalls === callsKey;
  const retry = batch?.phase === 'failed';
  const submitted = review.dispatched || (batch ? batch.phase === 'unknown' || batch.phase === 'complete' : review.broadcastHash !== null);
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
  const comparison = review.feeComparison;
  const showFeeChoices =
    review.feeChoice === null &&
    comparison !== null &&
    Boolean(
      comparison.gasLimit ||
        comparison.gasPrice ||
        comparison.maxFeePerGas ||
        comparison.maxPriorityFeePerGas
    );
  const feeChoicesDisabled =
    editingApproval ||
    review.busy ||
    submitted ||
    review.needsAccountSwitch ||
    review.error !== null ||
    expired;
  const chooseFee = (choice: EvmDappFeeChoice) => {
    const current = controller.getSnapshot().signingReview;
    if (
      feeChoicesDisabled ||
      review.expiresAt <= Date.now() ||
      current?.kind !== 'transaction' ||
      current.id !== review.id ||
      current.revision !== review.revision ||
      current.busy
    )
      return;
    void controller
      .chooseTransactionFee(review.id, review.revision, choice)
      .catch(() => undefined);
  };
  const approve = () => {
    if (expired || review.expiresAt <= Date.now()) return;
    if (!review.needsAccountSwitch && !ledger.canApprove()) return;
    if (approvalDraftRef.current?.id === review.id && approvalDraftRef.current.transaction === review.transaction) return;
    const action = review.needsAccountSwitch
      ? controller.activateRequestAccount(review.id, review.revision)
      : controller.approveRequest(review.id, review.revision, acknowledged);
    void action.catch(() => undefined);
  };
  const showError = review.error && review.error !== 'SITE_MISMATCH' &&
    !(review.error === 'BLOCKED_SITE' && review.verification.isScam);
  const amount = (units: string) => `${formatBaseUnits(units, review.decimals)} ${review.symbol}`;

  return <SafeAreaView edges={['top', 'bottom']} style={s.container}><KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Screen scrollResetKey={`${review.id}:${submitted ? 'result' : editingApproval ? 'edit' : 'review'}`} footer={<>
    {ledger.showConnect && !submitted && <Button title="Connect Ledger" variant="secondary" size="compact" onPress={ledger.connect} />}
    <View style={s.actions}>
    <Button title={submitted || review.broadcastHash ? 'Close' : 'Reject'} variant="secondary" onPress={close} style={s.action} />
    {!submitted && <Button title={review.needsAccountSwitch ? 'Switch account' : retry ? `Retry call ${batch!.index + 1}/${batch!.calls.length}` : batch ? `Confirm call ${batch.index + 1}/${batch.calls.length}` : 'Confirm'}
      disabled={expired || editingApproval || review.error !== null || review.busy || !review.needsAccountSwitch &&
        (ledger.blocked || !retry && (!prepared || review.requiresWarningAcknowledgement && !acknowledged))} onPress={approve} style={s.action} />}
    </View>
  </>} gap={16}>
    <Header title={batch ? 'Review calls' : 'Transaction request'} onBack={close} />
    <Card style={s.appCard}>
      <View style={s.appMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={s.appInitial}>{Array.from(review.appName.trim())[0]?.toUpperCase() || '•'}</Text></View>
      <View style={s.appCopy}><Text style={s.appName}>{review.appName}</Text>
      <Text selectable style={s.origin}>{review.networkLabel} · {review.origin}</Text></View>
    </Card>
    {transaction && <View style={s.hero}>
      {batch && <Text accessibilityRole="header" style={s.sectionTitle}>Call {batch.index + 1} of {batch.calls.length}</Text>}
      <Text style={[s.label, { textAlign: 'center' }]}>{transaction.to === null ? 'Contract deployment' : transaction.data === '0x' ? `${review.symbol} transfer` : 'Contract interaction'}</Text>
      <Text selectable style={[s.amount, amount(transaction.value).length > 22 && s.longAmount]} accessibilityLabel={amount(transaction.value)}>{formatBaseUnits(transaction.value, review.decimals)}</Text>
      <Text style={s.amountSymbol}>{review.symbol}</Text>
    </View>}
    <DappSiteStatus verification={review.verification} />
    {review.approval && transaction && <ApprovalReview summary={review.approval} transaction={transaction}
      onEditingChange={setApprovalEditing}
      disabled={!!batch || review.busy || submitted || review.needsAccountSwitch || review.error !== null}
      edit={(value) => controller.editApprovalAmount(review.id, review.revision, value)} />}
      <Card style={s.facts}>
        <View style={s.fact}><Text style={s.factLabel}>From</Text><View style={s.factValue}><Text style={s.factAccount}>{review.accountLabel}</Text><Text selectable style={s.factAddress}>{review.address}</Text></View></View>
        {transaction && <View style={s.fact}><Text style={s.factLabel}>{transaction.to === null ? 'Destination' : 'To'}</Text><Text selectable style={[s.factValue, s.factAddress]}>{transaction.to ?? 'New contract'}</Text></View>}
        <View style={s.fact}><Text style={s.factLabel}>Network</Text><Text style={[s.factValue, s.factText]}>{review.networkLabel} · Chain {review.chainId}</Text></View>
        <View style={s.fact}><Text style={s.factLabel}>Maximum network fee</Text><Text selectable style={[s.factValue, s.factText]}>{review.maximumFeeUnits === null ? 'Calculating…' : amount(review.maximumFeeUnits)}</Text></View>
        <View style={[s.fact, s.lastFact]}><Text style={s.factLabel}>Maximum total</Text><Text selectable style={[s.factValue, s.factText]}>{review.maximumTotalUnits === null ? 'Calculating…' : amount(review.maximumTotalUnits)}</Text></View>
      </Card>
    {transaction && <>
      {showFeeChoices && comparison && (
        <View style={s.feeNotice}>
          <Text accessibilityRole="header" style={s.feeTitle}>
            {comparison.recommendationOnly
              ? 'Below estimate'
              : 'Fee adjusted'}
          </Text>
          <Text style={s.feeDescription}>
            {comparison.recommendationOnly
              ? 'This fee is below the current estimate. The transaction may stay pending or fail.'
              : 'The dapp requested a fee below the current estimate. Pali raised it to reduce the chance of a stuck transaction.'}
          </Text>
          <Button
            title="Use dapp fee anyway"
            variant="secondary" size="compact"
            disabled={feeChoicesDisabled}
            onPress={() => chooseFee('dapp')}
          />
          {comparison.recommendationOnly && (
            <Button
              title="Use network suggestion"
              variant="secondary" size="compact"
              disabled={feeChoicesDisabled}
              onPress={() => chooseFee('network')}
            />
          )}
        </View>
      )}
      <Button title={detailsVisible ? 'Hide transaction details' : 'View transaction details'} variant="quiet" size="compact"
        icon={detailsVisible ? 'chevron-down' : 'chevron-right'} expanded={detailsVisible} onPress={() => setDetailsRevision(detailsVisible ? null : review.revision)} />
    </>}
    {transaction && detailsVisible && <TransactionDetails key={`${review.id}:${review.revision}`} transaction={transaction} />}
    {batch && <Card style={s.card}>
      <Button title={callsVisible ? 'Hide calls' : `View all ${batch.calls.length} calls`} variant="quiet" size="compact"
        expanded={callsVisible} onPress={() => setExpandedCalls(callsVisible ? null : callsKey)} />
      {callsVisible && batch.calls.map((call, index) => <View key={index} style={s.advisory}>
        <Text style={s.account}>{index + 1}. {call.status}</Text>
        <Text selectable style={s.address}>{call.to ?? 'New contract'}</Text>
        <Text>{amount(BigInt(call.value).toString())}</Text>
        {call.hash && <Text selectable style={s.address}>{call.hash}</Text>}
      </View>)}
    </Card>}
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
    {review.broadcastHash && !batch && <Card style={s.card}>
      <Text style={s.label}>Transaction ID</Text>
      <Text selectable style={s.address}>{review.broadcastHash}</Text>
    </Card>}
    {showError && review.error && batch?.phase !== 'unknown' && <Notice title={submitted ? 'Check transaction status' : 'Transaction unavailable'} body={reviewErrors[review.error]} />}
    {retry && <Notice title="Call not sent" body="Retry prepares a fresh review for the remaining calls. Completed calls stay saved." />}
    {batch?.phase === 'unknown' && <Notice title="Check call status" body="Delivery is uncertain. Check Activity before sending another request." />}
    {review.needsAccountSwitch && !review.error && !submitted &&
      <Text style={s.muted}>Switch to {review.accountLabel} to review this transaction.</Text>}
    {review.busy && <View style={s.progress}><ActivityIndicator color={colors.blue} />
      <Text>{submitted ? 'Sending transaction…' : transaction ? 'Please wait…' : 'Preparing transaction…'}</Text></View>}
  </Screen></KeyboardAvoidingView>{ledger.modal}</SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 10, padding: 16 },
  appCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  appMark: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  appInitial: { color: colors.bg, fontSize: 20, fontWeight: '700' },
  appCopy: { flex: 1, minWidth: 0, gap: 3 },
  appName: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  origin: { fontSize: 12, lineHeight: 18, color: colors.muted },
  hero: { alignItems: 'stretch', gap: 8, paddingVertical: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minWidth: 0 },
  facts: { overflow: 'hidden' },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lastFact: { borderBottomWidth: 0 },
  factLabel: { width: '38%', color: colors.muted, fontSize: 13, lineHeight: 20 },
  factValue: { flex: 1, minWidth: 0, gap: 3 },
  factAccount: { textAlign: 'right', fontSize: 13, lineHeight: 20, fontWeight: '500' },
  factAddress: { textAlign: 'right', fontSize: 12, lineHeight: 18, color: colors.muted },
  factText: { textAlign: 'right', fontSize: 13, lineHeight: 20 },
  account: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  amount: { width: '100%', flexShrink: 1, fontSize: 30, lineHeight: 39, fontWeight: '700', textAlign: 'center' },
  longAmount: { fontSize: 20, lineHeight: 29 },
  amountSymbol: { fontSize: 17, lineHeight: 24, color: colors.muted, textAlign: 'center' },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted },
  address: { fontSize: 13, lineHeight: 20, color: colors.muted },
  muted: { fontSize: 14, lineHeight: 22, color: colors.muted },
  feeNotice: {
    gap: 8,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 12,
    padding: 12,
  },
  feeTitle: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
    color: colors.amber,
  },
  feeDescription: { fontSize: 14, lineHeight: 21 },
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
