import React, { useState } from 'react';
import { getNativeNetwork } from '../../src/custody/networkContext';
import type { NativeGuardianRecoveryStatus } from '../../src/custody/evmTransferReadRpc';
import { WatchGuardianRecovery } from '../../src/screens/WatchGuardianRecovery';
import type {
  NativeGuardianPolicyDraft,
  NativeSmartAccountOperation,
  NativeSmartAccountOperationSnapshot,
} from '../../src/smartAccount/operation';
import { Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const guardian = '0x5555555555555555555555555555555555555555';
const moduleAddress = '0x7777777777777777777777777777777777777777';
const operationId = `0x${'ab'.repeat(32)}`;
const transactionHash = `0x${'cd'.repeat(32)}`;
const events: { method: string; draft?: NativeGuardianPolicyDraft }[] = [];
const subscribers = new Set<() => void>();
let resolveOpening: (() => void) | undefined;
let resolveInspection: (() => void) | undefined;
let inspections = 0;
let disposed = 0;
let snapshot: NativeSmartAccountOperationSnapshot;
const show = (patch: Partial<NativeSmartAccountOperationSnapshot>) => {
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
  for (const listener of subscribers) listener();
};
const controller = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
  async prepare() {},
  async authorize() {
    events.push({ method: 'authorize' });
    show({
      phase: 'review-fee',
      payerReview: {
        id: 2,
        purpose: 'submit-operation',
        coveredFeeUnits: '0',
        maximumFeeUnits: '420000000000000',
        maximumTotalUnits: '420000000000000',
        transaction: {
          from: '0x2222222222222222222222222222222222222222',
          to: moduleAddress,
          value: '0',
          data: '0x1234',
          nonce: '0',
          chainId: '1',
          gasLimit: '21000',
          type: 2,
          maxFeePerGas: '20000000000',
          maxPriorityFeePerGas: '1000000000',
          accessList: [],
        },
      },
    });
  },
  confirmPayer() {
    events.push({ method: 'confirm' });
    show({
      phase: 'complete',
      payerReview: null,
      transactionHash,
      metadataRefresh: query.has('refresh-fails') ? 'failed' : 'complete',
    });
  },
  async retryMetadata() {
    events.push({ method: 'refresh' });
    show({ metadataRefresh: 'complete' });
  },
  dispose() {
    disposed++;
  },
} as unknown as NativeSmartAccountOperation;

declare global {
  interface Window {
    __guardianPolicyFixture: {
      events(): typeof events;
      disposed(): number;
      resolveOpening(): void;
      resolveInspection(): void;
    };
  }
}
window.__guardianPolicyFixture = {
  events: () => events,
  disposed: () => disposed,
  resolveOpening: () => resolveOpening?.(),
  resolveInspection: () => resolveInspection?.(),
};

export function NativeGuardianPolicyFixture() {
  const [closed, setClosed] = useState(false);
  const [lifetime] = useState(() => new AbortController());
  const chainId = query.has('testnet') ? 5700 : 1;
  const pending = query.has('pending')
    ? {
        operationId,
        status: 'pending' as const,
        scheduledAt: 1762516800,
        executableAt: 1762776000,
        expiresAt: 1763035200,
      }
    : null;
  const status: NativeGuardianRecoveryStatus = {
    status: 'observed',
    observation: {
      account,
      chainId,
      moduleAddress,
      exists: !query.has('new-policy'),
      guardians: query.has('new-policy') ? [] : [guardian],
      guardianCount: query.has('new-policy') ? '0' : '1',
      threshold: query.has('new-policy') ? 0 : 1,
      delay: '259200',
      delaySeconds: 259200,
      expirationSeconds: 518400,
      policyEpoch: '1',
      pending,
      active: pending,
      knownOperation: null,
      observedBlock: {
        hash: `0x${'ef'.repeat(32)}`,
        number: 100,
        timestamp: 1762516800,
      },
    },
  };
  if (closed) return <Text>Guardian tool closed</Text>;
  return (
    <WatchGuardianRecovery
      address={account}
      networkLabel={chainId === 1 ? 'Ethereum' : 'Syscoin NEVM Testnet'}
      lifetime={lifetime.signal}
      onBack={() => {
        lifetime.abort();
        setClosed(true);
      }}
      read={async () => status}
      manage={
        query.has('read-only')
          ? undefined
          : {
              chainId,
              async inspectRemoval(_signal, assertCurrent) {
                events.push({ method: 'inspect' });
                inspections++;
                if (query.has('hold-inspection'))
                  await new Promise<void>((resolve) => {
                    resolveInspection = resolve;
                  });
                assertCurrent();
                const inspectionStatus = query.has('removal-removed')
                  ? 'removed'
                  : query.has('removal-unknown')
                  ? 'unknown'
                  : query.has('removal-pending') && inspections === 1
                  ? 'pending'
                  : 'retry-ready';
                return {
                  status: inspectionStatus,
                  totalPending: inspectionStatus === 'pending' ? 1 : 0,
                  transactions:
                    inspectionStatus === 'pending'
                      ? [
                          {
                            account,
                            chainId: String(chainId),
                            hash: transactionHash,
                            operationHash: operationId,
                            operationNonce: '7',
                            payer: guardian,
                            payerNonce: 1,
                          },
                        ]
                      : [],
                };
              },
              async open(draft, _signal, assertCurrent) {
                events.push({ method: 'open', draft });
                if (query.has('hold-open'))
                  await new Promise<void>((resolve) => {
                    resolveOpening = resolve;
                  });
                snapshot = {
                  phase: 'authorize',
                  revision: 1,
                  account,
                  network: getNativeNetwork(
                    chainId === 1 ? 'ethereum' : 'syscoin-nevm-testnet'
                  ),
                  intent: {
                    kind: 'guardian-policy',
                    command:
                      draft.action === 'remove'
                        ? {
                            kind: 'remove',
                            accountAddress: account,
                            moduleAddress,
                          }
                        : {
                            ...(status.observation.exists
                              ? {
                                  kind: 'update' as const,
                                  previousModuleAddress: moduleAddress,
                                }
                              : { kind: 'install' as const }),
                            accountAddress: account,
                            chainId,
                            guardian: draft.guardian,
                            delaySeconds: draft.delaySeconds,
                          },
                  },
                  maximumPrefundUnits: '3000000000000000',
                  userOperationHash: `0x${'12'.repeat(32)}`,
                  authorization: {
                    entryPoint: moduleAddress,
                    nonce: '0',
                    initCode: '0x',
                    callData: '0x1234',
                  },
                  payerReview: null,
                  transactionHash: null,
                  userOperationSubmissionStarted: false,
                  error: null,
                };
                // The real host performs this check too. Returning a late public fixture
                // model lets the screen's independent lifetime disposal be exercised.
                if (!query.has('hold-open')) assertCurrent();
                return controller;
              },
            }
      }
    />
  );
}
