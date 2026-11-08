import React, { useLayoutEffect, useState } from 'react';
import type { NativeConnectionsView, NativeMessageReview } from '../../src/connections/types';
import { NativeMessageReviewScreen } from '../../src/screens/NativeMessageReview';
import { Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const warning = query.has('warning');
const initialReview: NativeMessageReview = {
  id: 'message-1',
  revision: 7,
  method: query.has('typed') ? 'eth_signTypedData_v4' : 'personal_sign',
  appName: 'Example app',
  origin: 'https://example.invalid',
  accountLabel: 'Savings',
  address: '0x2222222222222222222222222222222222222222',
  networkLabel: 'Ethereum',
  chainId: '1',
  expiresAt: Date.now() + 300000,
  message: query.has('typed') ? null : 'Sign in to Example app.\nNonce: 12345678',
  typedData: query.has('typed') ? JSON.stringify({ domain: { name: 'Example', chainId: '1' }, message: { contents: 'Review every field', finalField: 'End of signed data' } }, null, 2) : null,
  order: null,
  error: query.has('delivery-uncertain') ? 'DELIVERY_UNCERTAIN' : query.has('invalid-origin') ? 'SITE_MISMATCH' : query.has('blocked') ? 'SIGNER_MISMATCH' : null,
  verification: { validation: query.has('invalid-origin') ? 'INVALID' : query.has('unverified') ? 'UNKNOWN' : 'VALID', isScam: false },
  busy: false,
  dispatched: query.has('delivery-uncertain'),
  needsAccountSwitch: query.has('switch'),
  advisories: warning ? [{ address: '0x3333333333333333333333333333333333333333', field: 'spender', severity: 'high', reason: 'Known phishing recipient' }] : [],
  requiresWarningAcknowledgement: warning,
};
const calls: { method: string; args: unknown[] }[] = [];

declare global {
  interface Window {
    __nativeMessageReviewFixture: {
      calls(): typeof calls;
      revise(): void;
    };
  }
}

export function NativeMessageReviewFixture() {
  const [review, setReview] = useState<NativeMessageReview | null>(initialReview);
  useLayoutEffect(() => {
    window.__nativeMessageReviewFixture = {
      calls: () => calls,
      revise: () => setReview((current) => current && { ...current, revision: current.revision + 1 }),
    };
  }, []);
  const controller: NativeConnectionsView = {
    getSnapshot() { throw new Error('The review receives its public snapshot from its parent'); },
    subscribe() { throw new Error('The review receives its public snapshot from its parent'); },
    async pair() { throw new Error('Pairing is outside this fixture'); },
    async approve() { throw new Error('Pairing is outside this fixture'); },
    async reject() { throw new Error('Pairing is outside this fixture'); },
    async disconnect() { throw new Error('Connections are outside this fixture'); },
    async retry() { throw new Error('Connections are outside this fixture'); },
    cancel() { throw new Error('Connections are outside this fixture'); },
    async activateMessageAccount(...args) {
      calls.push({ method: 'activateMessageAccount', args });
      setReview((current) => current && { ...current, revision: current.revision + 1, needsAccountSwitch: false });
    },
    async approveMessage(...args) {
      calls.push({ method: 'approveMessage', args });
      if (query.has('pending')) setReview((current) => current && { ...current, busy: true, dispatched: query.has('dispatched') });
      else setReview(null);
    },
    async rejectMessage(...args) {
      calls.push({ method: 'rejectMessage', args });
      setReview(null);
    },
  };
  return review ? <NativeMessageReviewScreen key={review.id} review={review} controller={controller} /> : <Text>Request completed</Text>;
}
