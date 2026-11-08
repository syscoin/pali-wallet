import React, { useState } from 'react';
import { createNativeNetwork } from '../../src/custody/networkContext';
import { NativeSmartAccountOperationScreen } from '../../src/screens/NativeSmartAccountOperation';
import type {
  NativeSmartAccountOperation,
  NativeSmartAccountOperationSnapshot,
  SmartAccountPayerReview,
} from '../../src/smartAccount/operation';
import { Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const payer = '0x2222222222222222222222222222222222222222';
const entryPoint = '0x3333333333333333333333333333333333333333';
const transactionHash = '0x' + 'ab'.repeat(32);
const longValues = query.has('long-values');
const maximumFeeUnits = '420000000000000';
const maximumPrefundUnits = longValues
  ? ((1n << 256n) - 1n - BigInt(maximumFeeUnits)).toString()
  : '3000000000000000';
type FixturePhase =
  | 'authorize'
  | 'fund-account'
  | 'submit-deployment'
  | 'waiting'
  | 'complete'
  | 'failed';
type Call = { method: string; value?: number };
const calls: Call[] = [];
const listeners = new Set<() => void>();
let snapshot: NativeSmartAccountOperationSnapshot = {
  intent: { kind: 'deploy' }, phase: 'authorize',
  revision: 7,
  account,
  network: createNativeNetwork({
    id: 'smart-deployment-fixture',
    name: longValues
      ? 'An exceptionally long custom network name for deployment review'
      : 'Ethereum',
    kind: 'evm',
    chainId: longValues ? '9007199254740991' : '1',
    slip44: 60,
    rpcUrl: 'https://example.invalid',
    symbol: 'ETH',
    decimals: 18,
    testnet: false,
  }),
  maximumPrefundUnits,
  userOperationHash: '0x' + 'cd'.repeat(32),
  authorization: {
    entryPoint,
    nonce: longValues ? ((1n << 256n) - 1n).toString() : '7',
    initCode: '0x' + '12'.repeat(longValues ? 1024 : 48),
    callData: '0x' + '34'.repeat(longValues ? 512 : 32),
  },
  payerReview: null,
  transactionHash: null,
  error: null,
};

function payerReview(
  purpose: SmartAccountPayerReview['purpose']
): SmartAccountPayerReview {
  const value = purpose === 'fund-account' ? maximumPrefundUnits : '0';
  return {
    id: purpose === 'fund-account' ? 8 : 9,
    purpose,
    maximumFeeUnits,
    maximumTotalUnits: (BigInt(value) + BigInt(maximumFeeUnits)).toString(),
    transaction: {
      chainId: snapshot.network.chainId,
      from: payer,
      to: purpose === 'fund-account' ? account : entryPoint,
      nonce: '0',
      value,
      data: purpose === 'fund-account' ? '0x' : '0x1234',
      gasLimit: '21000',
      type: 2,
      maxFeePerGas: '20000000000',
      maxPriorityFeePerGas: '1000000000',
      accessList: [],
    },
  };
}

function show(phase: FixturePhase) {
  snapshot = Object.freeze({
    ...snapshot,
    revision: snapshot.revision + 1,
    phase:
      phase === 'fund-account' || phase === 'submit-deployment'
        ? 'review-fee'
        : phase,
    payerReview:
      phase === 'fund-account' || phase === 'submit-deployment'
        ? payerReview(phase === 'submit-deployment' ? 'submit-operation' : phase)
        : null,
    transactionHash: ['waiting', 'complete', 'failed'].includes(phase)
      ? transactionHash
      : null,
    error:
      phase === 'failed'
        ? 'The network could not confirm this deployment. Check the latest transaction before trying again.'
        : null,
  });
  for (const listener of listeners) listener();
}

const phases: FixturePhase[] = [
  'authorize',
  'fund-account',
  'submit-deployment',
  'waiting',
  'complete',
  'failed',
];
const requestedPhase = query.get('deployment-phase');
if (phases.includes(requestedPhase as FixturePhase))
  show(requestedPhase as FixturePhase);

// Only the presentation's public store and actions are faked. This fixture never
// instantiates the deployment engine, wallet storage, an RPC client or a signer.
const controller = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async prepare() {
    calls.push({ method: 'prepare' });
  },
  async authorize(revision: number) {
    calls.push({ method: 'authorize', value: revision });
    show('fund-account');
  },
  confirmPayer(id: number) {
    calls.push({ method: 'confirmPayer', value: id });
    show(id === 8 ? 'submit-deployment' : 'waiting');
  },
  dispose() {
    calls.push({ method: 'dispose' });
  },
} as unknown as NativeSmartAccountOperation;

declare global {
  interface Window {
    __nativeSmartAccountDeploymentFixture: {
      calls(): Call[];
      show(phase: FixturePhase): void;
      revision(): number;
    };
  }
}
window.__nativeSmartAccountDeploymentFixture = {
  calls: () => calls,
  show,
  revision: () => snapshot.revision,
};

export function NativeSmartAccountOperationFixture() {
  const [closed, setClosed] = useState(false);
  return closed ? (
    <Text>Deployment screen closed</Text>
  ) : (
    <NativeSmartAccountOperationScreen
      controller={controller}
      onBack={() => {
        calls.push({ method: 'close' });
        setClosed(true);
      }}
    />
  );
}
