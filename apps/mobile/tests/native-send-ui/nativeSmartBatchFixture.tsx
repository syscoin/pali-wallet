import { unsupportedDappViews } from '../unsupportedDappPorts';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  NativeConnectionsSnapshot,
  NativeConnectionsView,
  NativeSmartTransactionReview,
} from '../../src/connections/types';
import { getNativeNetwork } from '../../src/custody/networkContext';
import { NativeCallsStatus } from '../../src/screens/NativeConnections';
import { NativeSmartTransactionReviewScreen } from '../../src/screens/NativeSmartTransactionReview';
import { Text } from '../../src/ui';

// Presentation-only public DTOs. No signer, custody runtime or transport is installed.
const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const payer = '0x2222222222222222222222222222222222222222';
const first = '0x3333333333333333333333333333333333333333';
const second = '0x4444444444444444444444444444444444444444';
const entryPoint = '0x5555555555555555555555555555555555555555';
const hash = '0x' + 'ab'.repeat(32);
const bundleId = '0x' + 'cd'.repeat(query.has('long-id') ? 512 : 32);
const calls = Object.freeze([
  Object.freeze({ to: first, value: '0x38d7ea4c68000', data: '0x12345678' }),
  Object.freeze({
    to: second,
    value: '0x71afd498d0000',
    data: query.has('long-data')
      ? '0x' + 'ef'.repeat(8192) + 'ab'
      : '0x87654321',
  }),
]);
const initial: NativeSmartTransactionReview = {
  kind: 'smart-transaction',
  method: 'wallet_sendCalls',
  id: 'batch-request-1',
  revision: 7,
  appName: 'Example batch app',
  origin: 'https://batch.example.invalid',
  accountLabel: 'Smart savings',
  address: account,
  networkLabel: 'Ethereum',
  chainId: '1',
  verification: { validation: 'VALID', isScam: false },
  expiresAt: Date.now() + 300000,
  error: null,
  needsAccountSwitch: false,
  busy: false,
  dispatched: false,
  advisories: [],
  requiresWarningAcknowledgement: false,
  approval: null,
  batchApprovals: [null, null],
  operation: {
    phase: 'authorize',
    revision: 1,
    account,
    network: getNativeNetwork('ethereum'),
    intent: { kind: 'dapp-batch', calls },
    maximumPrefundUnits: '210000000000000',
    userOperationHash: hash,
    authorization: {
      entryPoint,
      nonce: '7',
      initCode: '0x',
      callData: '0x1234',
    },
    payerReview: null,
    transactionHash: null,
    userOperationSubmissionStarted: false,
    error: null,
  },
};
type Status = NonNullable<NativeConnectionsSnapshot['callsStatus']>;
function statusView(): Status {
  const reverted = query.get('status') === '500';
  return {
    id: 'batch-status-1',
    origin: initial.origin,
    status: {
      version: '2.0.0',
      id: bundleId,
      chainId: '0x1',
      atomic: true,
      status: reverted ? 500 : 200,
      receipts: [
        {
          transactionHash: hash,
          blockHash: '0x' + '12'.repeat(32),
          blockNumber: '0x2a',
          gasUsed: '0x5208',
          status: reverted ? '0x0' : '0x1',
          logs: [],
        },
      ],
    },
  };
}
type View = {
  review: NativeSmartTransactionReview | null;
  status: Status | null;
  closed: boolean;
};
type RecordedCall = { method: string; args: unknown[] };
declare global {
  interface Window {
    __nativeSmartBatchFixture: {
      calls(): readonly RecordedCall[];
      expire(): void;
      refreshStatus(): void;
    };
  }
}

export function NativeSmartBatchFixture() {
  const [view, setView] = useState<View>(() => ({
    review: query.has('status') ? null : initial,
    status: query.has('status') ? statusView() : null,
    closed: false,
  }));
  const current = useRef(view);
  const recorded = useRef<RecordedCall[]>([]);
  useLayoutEffect(() => {
    current.current = view;
  }, [view]);
  useLayoutEffect(() => {
    window.__nativeSmartBatchFixture = {
      calls: () => recorded.current,
      expire: () =>
        setView((state) => ({
          ...state,
          review: state.review && {
            ...state.review,
            revision: state.review.revision + 1,
            error: 'TRANSACTION_UNAVAILABLE',
            operation: {
              ...state.review.operation,
              phase: 'failed',
              payerReview: null,
              error: 'The request expired. Request it again from the app.',
            },
          },
        })),
      refreshStatus: () =>
        setView((state) => ({
          ...state,
          status: state.status && { ...state.status },
        })),
    };
  }, []);
  const controller = useMemo<NativeConnectionsView>(() => {
    const unavailable = () => {
      throw new Error('Outside batch presentation fixture');
    };
    return {
      isRequestAuthenticating: () => false,
      ...unsupportedDappViews,
      getSnapshot: () => ({
        revision: current.current.review?.revision ?? 0,
        status: 'ready',
        pairingExpiresAt: null,
        accounts: [],
        selectedAccountId: null,
        network: null,
        proposals: [],
        sessions: [],
        preparationReview: null, controlReview: null, sentryReview: null, psbtReview: null, signingReview: current.current.review,
        callsStatus: current.current.status,
        error: null,
      }),
      subscribe: unavailable,
      pair: unavailable,
      approve: unavailable,
      reject: unavailable,
      disconnect: unavailable,
      retry: unavailable,
      cancel: unavailable,
      activateRequestAccount: unavailable,
      async chooseTransactionFee() { throw new Error('Fee choices are unavailable for this fixture'); },
      editApprovalAmount: unavailable,
      async approveRequest(...args) {
        const review = current.current.review;
        if (
          !review ||
          args[0] !== review.id ||
          args[1] !== review.revision ||
          review.error ||
          !args[2]
        )
          unavailable();
        recorded.current.push({ method: 'approveRequest', args });
        setView((state) => ({
          ...state,
          review: state.review && {
            ...state.review,
            revision: state.review.revision + 1,
            operation: {
              ...state.review.operation,
              phase: 'review-fee',
              revision: 2,
              payerReview: {
                id: 3,
                purpose: 'submit-operation',
                coveredFeeUnits: '0',
                maximumFeeUnits: '420000000000000',
                maximumTotalUnits: '420000000000000',
                transaction: {
                  type: 2,
                  chainId: '1',
                  from: payer,
                  to: entryPoint,
                  value: '0',
                  data: '0x1234',
                  nonce: '2',
                  gasLimit: '420000',
                  maxFeePerGas: '1000000000',
                  maxPriorityFeePerGas: '1000000000',
                  accessList: [],
                },
              },
            },
          },
        }));
      },
      async retrySmartMetadata() { throw new Error('Smart metadata refresh is outside this fixture'); },
      async confirmSmartPayer(...args) {
        const review = current.current.review;
        if (
          !review ||
          args[0] !== review.id ||
          args[1] !== review.revision ||
          args[2] !== review.operation.payerReview?.id ||
          review.error
        )
          unavailable();
        recorded.current.push({ method: 'confirmSmartPayer', args });
        setView((state) => ({
          ...state,
          review: state.review && {
            ...state.review,
            revision: state.review.revision + 1,
            dispatched: true,
            operation: {
              ...state.review.operation,
              phase: 'complete',
              payerReview: null,
              transactionHash: hash,
            },
          },
        }));
      },
      async rejectRequest(...args) {
        recorded.current.push({ method: 'rejectRequest', args });
        setView({ review: null, status: null, closed: true });
      },
      async callsStatusShown(...args) {
        if (args[0] !== current.current.status?.id) unavailable();
        recorded.current.push({ method: 'callsStatusShown', args });
      },
      dismissCallsStatus(...args) {
        recorded.current.push({ method: 'dismissCallsStatus', args });
        setView({ review: null, status: null, closed: true });
      },
    };
  }, []);
  if (view.status)
    return <NativeCallsStatus view={view.status} controller={controller} />;
  if (view.review)
    return (
      <NativeSmartTransactionReviewScreen
        review={view.review}
        controller={controller}
      />
    );
  return <Text>{view.closed ? 'Request closed' : 'No request'}</Text>;
}
