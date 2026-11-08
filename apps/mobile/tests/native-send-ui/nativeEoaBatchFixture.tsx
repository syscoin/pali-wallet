import React, { useLayoutEffect, useRef, useState } from 'react';
import type {
  NativeConnectionsView,
  NativeTransactionReview,
} from '../../src/connections/types';
import { NativeTransactionReviewScreen } from '../../src/screens/NativeTransactionReview';
import { Text } from '../../src/ui';

// Public presentation states only. No wallet, signer or RPC transport is installed.
const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const targets = [
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  ...(query.has('many')
    ? [4, 5, 6].map((digit) => `0x${String(digit).repeat(40)}`)
    : []),
];
const firstHash = `0x${'ab'.repeat(32)}`;
const secondHash = `0x${'cd'.repeat(32)}`;
type Phase = NonNullable<NativeTransactionReview['batch']>['phase'];
type Recorded = { method: string; args: unknown[] };

function reviewFor(
  index: number,
  phase: Phase,
  revision: number
): NativeTransactionReview {
  const complete = phase === 'complete';
  const unknown = phase === 'unknown';
  const value = index === 0 ? '1000000000000000' : '2000000000000000';
  const maximumFeeUnits = index === 0 ? '42000000000000' : '63000000000000';
  const transaction =
    phase === 'failed'
      ? null
      : {
          type: 2 as const,
          from: account,
          to: targets[index]!,
          value,
          data: '0x',
          chainId: '743211',
          nonce: String(5 + index),
          gasLimit: '21000',
          maxFeePerGas: index === 0 ? '2000000000' : '3000000000',
          maxPriorityFeePerGas: '1000000000',
          accessList: [],
        };
  return {
    feeComparison: null,
    feeChoice: null,
    kind: 'transaction',
    method: 'wallet_sendCalls',
    id: 'eoa-batch-1',
    revision,
    appName: 'Example batch app',
    origin: 'https://batch.example.invalid',
    accountLabel: 'Savings',
    address: account,
    networkLabel: 'Custom network',
    chainId: '743211',
    symbol: 'COIN',
    decimals: 18,
    expiresAt: Date.now() + 90000,
    transaction,
    maximumFeeUnits: transaction ? maximumFeeUnits : null,
    maximumTotalUnits: transaction
      ? (BigInt(value) + BigInt(maximumFeeUnits)).toString()
      : null,
    error: unknown ? 'DELIVERY_UNCERTAIN' : null,
    verification: { validation: 'VALID', isScam: false },
    busy: false,
    needsAccountSwitch: false,
    dispatched: complete || unknown,
    broadcastHash: index > 0 ? firstHash : null,
    advisories: [],
    requiresWarningAcknowledgement: false,
    approval: null,
    batch: {
      phase,
      index,
      calls: targets.map((to, current) => ({
        to,
        value: current === 0 ? '0x38d7ea4c68000' : '0x71afd498d0000',
        status:
          complete || current < index
            ? 'success'
            : current === index && unknown
            ? 'unknown'
            : current === index && phase === 'failed'
            ? 'error'
            : 'pending',
        ...(current < index || complete
          ? { hash: current === 0 ? firstHash : secondHash }
          : {}),
      })),
    },
  };
}

declare global {
  interface Window {
    __nativeEoaBatchFixture: { calls(): readonly Recorded[]; expire(): void };
  }
}

export function NativeEoaBatchFixture() {
  const [review, setReview] = useState<NativeTransactionReview | null>(() =>
    query.has('failed')
      ? reviewFor(1, 'failed', 7)
      : query.has('unknown')
      ? reviewFor(1, 'unknown', 7)
      : reviewFor(0, 'review', 7)
  );
  const recorded = useRef<Recorded[]>([]);
  useLayoutEffect(() => {
    window.__nativeEoaBatchFixture = {
      calls: () => recorded.current,
      expire: () =>
        setReview(
          (current) =>
            current && {
              ...current,
              revision: current.revision + 1,
              error: 'TRANSACTION_UNAVAILABLE',
            }
        ),
    };
  }, []);
  const unavailable = (): never => {
    throw new Error('Outside EOA batch presentation fixture');
  };
  const controller: NativeConnectionsView = {
    getSnapshot: () => ({
      revision: review?.revision ?? 0,
      status: 'ready',
      accounts: [],
      selectedAccountId: null,
      network: null,
      proposals: [],
      sessions: [],
      signingReview: review,
      callsStatus: null,
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
    chooseTransactionFee: unavailable,
    editApprovalAmount: unavailable,
    confirmSmartPayer: unavailable,
    callsStatusShown: unavailable,
    dismissCallsStatus: unavailable,
    async approveRequest(...args) {
      if (
        !review ||
        review.error ||
        args[0] !== review.id ||
        args[1] !== review.revision
      )
        return unavailable();
      recorded.current.push({ method: 'approveRequest', args });
      const { phase, index } = review.batch!;
      setReview(
        reviewFor(
          phase === 'failed' ? index : Math.min(index + 1, targets.length - 1),
          phase === 'failed' || index < targets.length - 1
            ? 'review'
            : 'complete',
          review.revision + 1
        )
      );
    },
    async rejectRequest(...args) {
      if (!review || args[0] !== review.id) return unavailable();
      recorded.current.push({ method: 'rejectRequest', args });
      setReview(null);
    },
  };
  return review ? (
    <NativeTransactionReviewScreen review={review} controller={controller} />
  ) : (
    <Text>Request closed</Text>
  );
}
