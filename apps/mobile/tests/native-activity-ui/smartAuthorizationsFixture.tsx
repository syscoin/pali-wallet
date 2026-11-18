// Public synthetic instructions only; no custody, signing or RPC adapter.
import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NativeSmartAccountAuthorizations,
  type NativeSmartAuthorizationSource,
} from '../../src/screens/NativeSmartAccountAuthorizations';
import { Notice } from '../../src/ui';

const hash = (value: string) => `0x${value.repeat(64)}`;
const nonce = ((BigInt(1) << BigInt(256)) - BigInt(2)).toString();
const anchor = { number: '100', hash: hash('a') };
const source: NativeSmartAuthorizationSource = {
  async list(_options, _signal, guard) {
    guard();
    return { entries: [{
      account: `0x${'11'.repeat(20)}`, chainId: '1', createdAt: 1700000000000,
      operationHash: hash('1'), operationNonce: nonce,
      payer: `0x${'22'.repeat(20)}`, observedAt: anchor,
    }], nextCursor: null };
  },
  async status(operationHash, _signal, guard) {
    guard();
    return { kind: 'nonce-consumed', operationHash,
      currentNonce: (BigInt(nonce) + BigInt(1)).toString(), anchor };
  },
};
export function SmartAuthorizationsFixture() {
  const [result, setResult] = useState('');
  return <SafeAreaProvider>{result ? <Notice title={result} /> : (
    <NativeSmartAccountAuthorizations source={source} accountLabel="Smart Account 1 · Ethereum"
      onBack={() => setResult('Activity')}
      onCancel={() => setResult('Cancellation review requested')} />
  )}</SafeAreaProvider>;
}
