import { useNativeTranslation } from '../platform/localization';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { useDappLedgerConnection } from './useDappLedgerConnection';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const { t } = useNativeTranslation();
  const ledger = useDappLedgerConnection({review, controller, ledgerConnection});
  const requestId = review.id;
  const authentication = useMemo(() => ({ isAuthenticating: () => controller.isRequestAuthenticating(requestId) }), [controller, requestId]);
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
      authentication={authentication}
      state={review.operation}
      assetTransfer={review.assetTransfer}
      batchAssetTransfers={review.batchAssetTransfers}
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
          {ledger.showConnect && <Button title={t('mobile.accounts.connectLedger')} variant="secondary" size="compact" onPress={ledger.connect} />}
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
              chainId={review.chainId}
              registrationHash={review.operation.network.registrationHash}
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
                  <Text>{t('mobile.dappConsent.smartTransactionReview.callApproval', { index: index + 1 })}</Text>
                  <ApprovalReview
                    summary={{ ...summary, canEditAmount: false }}
                    transaction={intent}
                    chainId={review.chainId}
                    registrationHash={review.operation.network.registrationHash}
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
                t('mobile.dappConsent.messageReview.thisAddressAppearsOnAKnownUnsafe')
              }
            />
          ))}
          {review.requiresWarningAcknowledgement && (
            <IdlePressable
              accessibilityRole="checkbox"
              accessibilityLabel={t('mobile.dappConsent.messageReview.iUnderstandTheAddressWarning')}
              accessibilityState={{
                checked: warningsAccepted,
                disabled: review.busy,
              }}
              disabled={review.busy}
              onPress={() => setAcknowledged(warningsAccepted ? null : intent)}
            >
              <Text>
                {warningsAccepted ? '✓ ' : ''}{t('mobile.dappConsent.messageReview.iUnderstandTheAddressWarning1')}
              </Text>
            </IdlePressable>
          )}
          {review.needsAccountSwitch && (
            <Button
              title={t('mobile.dappConsent.messageReview.switchAccount')}
              onPress={() => {
                void controller
                  .activateRequestAccount(review.id, review.revision)
                  .catch(() => undefined);
              }}
            />
          )}
          {review.error && (
            <Notice
              title={t('mobile.dappConsent.transactionReview.transactionUnavailable')}
              body={
                review.error === 'DELIVERY_UNCERTAIN'
                  ? t('mobile.dappConsent.transactionReview.theResultCouldNotBeConfirmedCheck')
                  : t('mobile.dappConsent.smartTransactionReview.thisRequestIsNoLongerAvailableRequest')
              }
            />
          )}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({ site: { padding: 16, gap: 8 } });
