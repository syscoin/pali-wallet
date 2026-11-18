// Public synthetic Activity data only. The fixture has no custody or RPC adapter.
import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeActivity, type NativeActivityRuntime } from '../../src/activity/nativeActivity';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW } from '../../src/activity/types';
import { NativeActivityScreen } from '../../src/screens/NativeActivity';
import { Notice } from '../../src/ui';

const hash = (value: string) => `0x${value.repeat(64)}`;
const address = `0x${'11'.repeat(20)}`;
const nonce = ((BigInt(1) << BigInt(256)) - BigInt(2)).toString();
const anchor = { number: '100', hash: hash('a') };
const operationHash = hash('1');
const transactionHash = hash('2');
const orphanHash = hash('3');
const payer = `0x${'22'.repeat(20)}`;
const operation = { operationHash, operationNonce: nonce };
const scope = { ...createActivityScope('a'.repeat(64), 'smart:60:0', address, 'ethereum'), apiUrl: '' };
const runtime: NativeActivityRuntime = {
  async load(guard) {
    guard();
    return { scope, locals: [{
      walletFingerprint: scope.walletFingerprint, accountId: scope.accountId,
      networkId: scope.network.id, registrationHash: scope.network.registrationHash,
      hash: transactionHash, address, chainId: '1', createdAt: 1700000001000,
      nonce: 0, recipient: payer, amountUnits: '1', maximumFeeUnits: '10', phase: 'submitted', operation: 'send',
      smartAccount: { payer, operations: [operation] },
    }], saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false },
      smartAuthorizations: { entries: [operationHash, orphanHash].map(operationHash => ({
        account: address, chainId: '1', createdAt: 1700000000000,
        operationHash, operationNonce: nonce, payer, observedAt: anchor,
      })), nextCursor: null } };
  },
  async observeSmartAuthorization(_scope, operationHash, guard) {
    guard();
    if (new URLSearchParams(window.location.search).has('pending'))
      return { kind: 'pending', operationHash, currentNonce: nonce, anchor };
    return { kind: 'nonce-consumed', operationHash, currentNonce: (BigInt(nonce) + BigInt(1)).toString(), anchor };
  },
  async saveCache() {},
  async saveView() {},
};
export function SmartAuthorizationsFixture() {
  const [result, setResult] = useState('');
  const [controller] = useState(() => new NativeActivity({
    getSnapshot: () => ({ phase: 'ready', revision: 0 }),
    subscribe: () => () => undefined,
  }, () => runtime));
  return <SafeAreaProvider>{result ? <Notice title={result} /> : (
    <NativeActivityScreen controller={controller} accountLabel="Smart Account 1"
      onBack={() => setResult('Activity')} onCancelPending={() => setResult('Cancellation review requested')} />
  )}</SafeAreaProvider>;
}
