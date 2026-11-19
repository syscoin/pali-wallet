// Public synthetic Activity data only. The fixture has no custody or RPC adapter.
import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountActivityController } from '../../src/activity/accountActivity';
import { decodeActivityPage } from '../../src/activity/explorerReader';
import { NativeActivity, type NativeActivityRuntime } from '../../src/activity/nativeActivity';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW } from '../../src/activity/types';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
import { AllNetworksActivity } from '../../src/screens/AllNetworksActivity';
import { NativeActivityScreen } from '../../src/screens/NativeActivity';
import { Notice } from '../../src/ui';

const hash = (value: string) => `0x${value.repeat(64)}`;
const address = `0x${'11'.repeat(20)}`;
const nonce = ((BigInt(1) << BigInt(256)) - BigInt(2)).toString();
const anchor = { number: '100', hash: hash('a') };
const operationHash = hash('1');
const transactionHash = hash('2');
const orphanHash = hash('3');
const discoveredHash = hash('4');
const payer = `0x${'22'.repeat(20)}`;
const operation = { operationHash, operationNonce: nonce };
const query = new URLSearchParams(window.location.search);
const discoveredOuter = query.has('observed-outer');
const scope = { ...createActivityScope('a'.repeat(64), 'smart:60:0', address, 'ethereum'), apiUrl: discoveredOuter ? 'https://indexer.example/api' : '' };
const olderPage = query.has('older-authorization');
const outerObservation = discoveredOuter ? new Promise<void>(resolve => {
  window.addEventListener('show-observed-outer', () => resolve(), { once: true });
}) : undefined;
const authorization = (operationHash: string) => ({
  account: address, chainId: '1', createdAt: 1700000000000,
  operationHash, operationNonce: nonce, payer, observedAt: anchor,
});
const firstPage = Array.from({ length: 20 }, (_, index) => authorization('0x' + (index + 64).toString(16).padStart(64, '0')));
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
      smartAuthorizations: olderPage ? { entries: firstPage, nextCursor: firstPage.at(-1)!.operationHash }
        : { entries: [operationHash, orphanHash].map(authorization), nextCursor: null } };
  },
  async loadSmartAuthorizations(_scope, cursor, guard) {
    guard();
    if (!olderPage || cursor !== firstPage.at(-1)!.operationHash) throw Error('Unexpected authorization cursor');
    return { entries: [authorization(operationHash)], nextCursor: null };
  },
  async loadTarget(_scope, target, guard) {
    guard();
    return target === operationHash ? { authorization: authorization(target) } : null;
  },
  async observeSmartAuthorization(_scope, operationHash, guard) {
    guard();
    if (query.has('unavailable') && operationHash === orphanHash) throw Error('Status unavailable');
    if (query.has('pending'))
      return { kind: 'pending', operationHash, currentNonce: nonce, anchor };
    if ((query.has('observed') || discoveredOuter) && operationHash === orphanHash) {
      await outerObservation;
      guard();
      return { kind: 'observed', operationHash, currentNonce: (BigInt(nonce) + 1n).toString(), anchor,
        block: anchor, success: false, transactionHash: discoveredHash };
    }
    return { kind: 'nonce-consumed', operationHash, currentNonce: (BigInt(nonce) + BigInt(1)).toString(), anchor };
  },
  async saveCache() {},
  async saveView() {},
};
function allNetworksController() {
  return new AccountActivityController({
    source: {
      getSnapshot: () => ({ phase: 'ready', revision: 0, presence: 'existing', backup: 'confirmed',
        account: { address, network: scope.network.id }, error: null }),
      getCatalogue: () => ({ active: { accountId: scope.accountId } }) as NativeWalletCatalogueSnapshot,
      subscribe: () => () => undefined,
    },
    choices: () => [{ label: 'Smart Account 1', networkName: scope.network.name, symbol: scope.network.symbol,
      scope: { id: scope.key, accountId: scope.accountId, accountAddress: address, accountType: 'SmartAccount', network: scope.network } }],
    runtime: () => runtime,
    filter: { async load() { return 'all'; }, async save() {} },
    explorer: { async page(_scope, feed, _page, _signal, guard) {
      guard();
      return discoveredOuter && feed === 'txlist' ? decodeActivityPage({ status: '1', result: [{
        hash: discoveredHash, from: payer, to: address, value: '1', nonce: '5', timeStamp: '1700000002',
        blockNumber: '100', confirmations: '1', txreceipt_status: '1',
      }] }, feed, address, Number(scope.network.chainId)) : [];
    } },
    receipts: { async read() { return null; } },
  });
}
export function SmartAuthorizationsFixture() {
  const [result, setResult] = useState('');
  const [controller] = useState(() => new NativeActivity({
    getSnapshot: () => ({ phase: 'ready', revision: 0 }),
    subscribe: () => () => undefined,
  }, () => runtime));
  const [allNetworks] = useState(allNetworksController);
  if (query.has('account-activity')) return <SafeAreaProvider>{result ? <Notice title={result} /> : (
    <AllNetworksActivity controller={allNetworks} accountLabel="Smart Account 1"
      onAction={async (entry, action, hash, guard, reference) => {
        guard();
        setResult(entry.choice.scope.network.id === 'ethereum' && action === 'cancel' && hash === orphanHash && reference?.originalHash === orphanHash
          ? 'Exact cancellation review requested' : 'Wrong operation');
      }} />
  )}</SafeAreaProvider>;
  return <SafeAreaProvider>{result ? <Notice title={result} /> : (
    <NativeActivityScreen controller={controller} accountLabel="Smart Account 1"
      onBack={() => setResult('Activity')} onCancelPending={(key, reference) => setResult(reference === undefined
        ? 'Cancellation review requested'
        : key === `operation:${orphanHash}` && reference.originalHash === orphanHash ? 'Exact cancellation review requested' : 'Wrong operation')} />
  )}</SafeAreaProvider>;
}
