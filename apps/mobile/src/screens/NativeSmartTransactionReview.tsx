import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { useDappLedgerConnection } from './useDappLedgerConnection';
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import type {
  NativeConnectionsView,
  NativeSmartTransactionReview,
} from '../connections/types';
import { NativeSmartAccountOperationContent } from './NativeSmartAccountOperation';
import { ApprovalReview } from './ApprovalReview';
import { DappSiteStatus } from './DappSiteStatus';
import { IdlePressable } from './IdleActivityBoundary';
import { Button, Card, Notice, Text } from '../ui';

export function NativeSmartTransactionReviewScreen({
  review,
  controller,
  ledgerConnection,
}: {
  ledgerConnection?: NativeLedgerConnectionView;
  review: NativeSmartTransactionReview;
  controller: NativeConnectionsView;
}) {
  const ledger = useDappLedgerConnection({review, controller, ledgerConnection});
  const [acknowledged, setAcknowledged] = useState<object | null>(null);
  const [editing, setEditing] = useState<object | null>(null);
  const editingRef = useRef(editing);
  const close = () => {
    void controller.rejectRequest(review.id).catch(() => undefined);
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        void controller.rejectRequest(review.id).catch(() => undefined);
        return true;
      }
    );
    return () => subscription.remove();
  }, [controller, review.id]);
  const intent = review.operation.intent;
  const warningsAccepted =
    !review.requiresWarningAcknowledgement || acknowledged === intent;
  return (
    <NativeSmartAccountOperationContent
      state={review.operation}
      onBack={close}
      disabled={
        (review.operation.phase === 'authorize' && ledger.blocked) || review.error !== null ||
        review.needsAccountSwitch ||
        !warningsAccepted ||
        editing === intent
      }
      authorize={(acknowledgedCustomRisk) => {
        if (editingRef.current === intent || !ledger.canApprove()) return;
        const requiresCustomRisk = intent.kind === 'modules' && intent.command.draft.kind === 'install-custom';
        if (requiresCustomRisk && acknowledgedCustomRisk !== true) return;
        void controller
          .approveRequest(review.id, review.revision, warningsAccepted && (!requiresCustomRisk || acknowledgedCustomRisk === true))
          .catch(() => undefined);
      }}
      retryMetadata={() => { void controller.retrySmartMetadata(review.id, review.revision).catch(() => undefined); }}
      confirmPayer={(id) => {
        void controller
          .confirmSmartPayer(review.id, review.revision, id)
          .catch(() => undefined);
      }}
      before={
        <>
          {ledger.showConnect && <Button title="Connect Ledger" variant="secondary" onPress={ledger.connect} />}
          {ledger.modal}
          <Card style={styles.site}>
            <Text>{review.appName}</Text>
            <Text selectable>{review.origin}</Text>
            <DappSiteStatus verification={review.verification} />
          </Card>
          {review.approval && (
            <ApprovalReview
              summary={review.approval}
              transaction={intent}
              disabled={
                review.busy ||
                review.operation.phase !== 'authorize' ||
                review.error !== null ||
                review.needsAccountSwitch
              }
              edit={(amount) =>
                controller.editApprovalAmount(
                  review.id,
                  review.revision,
                  amount
                )
              }
              onEditingChange={(active) => {
                const current = controller.getSnapshot().signingReview;
                if (
                  current?.kind !== 'smart-transaction' ||
                  current.id !== review.id ||
                  current.operation.intent !== intent
                )
                  return;
                if (!active && editingRef.current !== intent) return;
                editingRef.current = active ? intent : null;
                setEditing(editingRef.current);
              }}
            />
          )}
          {review.batchApprovals?.map(
            (summary, index) =>
              summary && (
                <React.Fragment key={index}>
                  <Text>Call {index + 1} approval</Text>
                  <ApprovalReview
                    summary={{ ...summary, canEditAmount: false }}
                    transaction={intent}
                    disabled
                    edit={async () => {
                      throw new Error('Batch approval is read-only');
                    }}
                    onEditingChange={() => undefined}
                  />
                </React.Fragment>
              )
          )}
          {review.advisories.map((entry) => (
            <Notice
              key={entry.address + entry.field}
              title={entry.field}
              body={
                entry.reason ??
                'This address appears on a known unsafe-address list.'
              }
            />
          ))}
          {review.requiresWarningAcknowledgement && (
            <IdlePressable
              accessibilityRole="checkbox"
              accessibilityLabel="I understand the address warning"
              accessibilityState={{
                checked: warningsAccepted,
                disabled: review.busy,
              }}
              disabled={review.busy}
              onPress={() => setAcknowledged(warningsAccepted ? null : intent)}
            >
              <Text>
                {warningsAccepted ? '✓ ' : ''}I understand the address warning.
              </Text>
            </IdlePressable>
          )}
          {review.needsAccountSwitch && (
            <Button
              title="Switch account"
              onPress={() => {
                void controller
                  .activateRequestAccount(review.id, review.revision)
                  .catch(() => undefined);
              }}
            />
          )}
          {review.error && (
            <Notice
              title="Transaction unavailable"
              body={
                review.error === 'DELIVERY_UNCERTAIN'
                  ? 'The result could not be confirmed. Check Activity before trying again.'
                  : 'This request is no longer available. Request it again from the app.'
              }
            />
          )}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({ site: { padding: 20, gap: 8 } });
