import React, { useState } from 'react';
import { NativeAccountChangeReview } from '../../src/screens/NativeAccountChangeReview';
import type { NativeAccountChangeReview as Review } from '../../src/connections/accountChangeRequests';
import { Screen, Text } from '../../src/ui';

/** Public gallery DTO only: no keyring, network transport or wallet storage. */
export function NativeAccountChangeFixture() {
  const [result, setResult] = useState('');
  const [review, setReview] = useState<Review>(() => ({ id: 'account-gallery', revision: 1,
    appName: 'Example staking app', origin: 'https://app.example.test', verification: { validation: 'UNKNOWN', isScam: false },
    networkLabel: 'Ethereum', chainId: 'eip155:1', expiresAt: Date.now() + 300000, busy: false, error: null,
    currentAccountId: 'daily', selectedAccountId: 'daily', accounts: [
      { id: 'daily', type: 'HDAccount', label: 'Daily wallet', address: '0x1111111111111111111111111111111111111111' },
      { id: 'ledger', type: 'Ledger', label: 'Ledger savings', address: '0x2222222222222222222222222222222222222222' },
      { id: 'treasury', type: 'SmartAccount', label: 'Family treasury', address: '0x3333333333333333333333333333333333333333' },
    ] }));
  if (result) return <Screen><Text>{result}</Text></Screen>;
  return <NativeAccountChangeReview review={review} onUnavailable={() => setResult('Connection unavailable')} controller={{
    getSnapshot: () => ({ error: null }) as never,
    selectConnectionAccount: (_id, selectedAccountId) => setReview(current => ({ ...current, selectedAccountId, revision: current.revision + 1 })),
    approveAccountChange: async () => { setResult('Account selection approved'); },
    rejectAccountChange: async () => { setResult('Account selection rejected'); },
  }} />;
}
