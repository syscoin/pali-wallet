import React, { useLayoutEffect, useState } from 'react';
import type { NativeConnectionsView, NativeTransactionReview } from '../../src/connections/types';
import { NativeTransactionReviewScreen } from '../../src/screens/NativeTransactionReview';
import { Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const initialReview: NativeTransactionReview = {
  kind: 'transaction', method: 'eth_sendTransaction', id: 'transaction-1', revision: 7,
  appName: 'Example app', origin: 'https://example.invalid', accountLabel: 'Savings',
  address: '0x2222222222222222222222222222222222222222', networkLabel: 'Custom network',
  chainId: '743211', symbol: 'COIN', decimals: 18, expiresAt: Date.now() + 300000,
  transaction: query.has('preparing') ? null : {
    type: 2, from: '0x2222222222222222222222222222222222222222',
    to: query.has('deployment') ? null : '0x3333333333333333333333333333333333333333',
    chainId: '743211', value: '1234567890123456789012345', gasLimit: '25200',
    maxFeePerGas: '10', maxPriorityFeePerGas: '1', nonce: '3',
    data: query.has('large-data') ? '0x' + 'ab'.repeat(8192) + 'cd' : '0xabcdef',
    accessList: [{ address: '0x4444444444444444444444444444444444444444', storageKeys: ['0x' + '5'.repeat(64)] }],
  },
  maximumFeeUnits: query.has('preparing') ? null : '252000',
  maximumTotalUnits: query.has('preparing') ? null : '1234567890123456789264345',
  error: query.has('invalid-origin') ? 'SITE_MISMATCH' : query.has('uncertain') ? 'DELIVERY_UNCERTAIN' : null,
  verification: { validation: query.has('invalid-origin') ? 'INVALID' : 'VALID', isScam: false },
  busy: query.has('preparing') || query.has('broadcasting'), needsAccountSwitch: query.has('switch'),
  dispatched: query.has('uncertain'),
  broadcastHash: query.has('uncertain') || query.has('broadcasting') ? '0x' + '6'.repeat(64) : null,
  advisories: query.has('warning') ? [{ address: '0x3333333333333333333333333333333333333333', field: 'spender', severity: 'high', reason: 'Known unsafe recipient' }] : [],
  requiresWarningAcknowledgement: query.has('warning'),
};
const calls: { method: string; args: unknown[] }[] = [];

declare global {
  interface Window {
    __nativeTransactionReviewFixture: { calls(): typeof calls; revise(): void };
  }
}

export function NativeTransactionReviewFixture() {
  const [review, setReview] = useState<NativeTransactionReview | null>(initialReview);
  useLayoutEffect(() => {
    window.__nativeTransactionReviewFixture = {
      calls: () => calls,
      revise: () => setReview((current) => current && { ...current, revision: current.revision + 1 }),
    };
  }, []);
  const unavailable = () => { throw new Error('Outside transaction review fixture'); };
  const controller: NativeConnectionsView = {
    getSnapshot: unavailable, subscribe: unavailable, pair: unavailable, approve: unavailable,
    reject: unavailable, disconnect: unavailable, cancel: unavailable, retry: unavailable,
    async activateRequestAccount(...args) {
      calls.push({ method: 'activateRequestAccount', args });
      setReview((current) => current && { ...current, revision: current.revision + 1, needsAccountSwitch: false });
    },
    async approveRequest(...args) {
      calls.push({ method: 'approveRequest', args });
      setReview(null);
    },
    async rejectRequest(...args) {
      calls.push({ method: 'rejectRequest', args });
      setReview(null);
    },
  };
  return review ? <NativeTransactionReviewScreen key={review.id} review={review} controller={controller} /> : <Text>Request completed</Text>;
}
