import React, { useState } from 'react';
import { NativeGuardianRecovery } from '../../src/screens/NativeGuardianRecovery';
import {
  NativeGuardianRecoveryController,
  type NativeGuardianRecoveryAction,
  type NativeGuardianRecoveryChoice,
} from '../../src/smartAccount/guardianRecovery';
import type { NativeGuardianRecoveryIntent } from '../../src/custody/walletCatalogue';
import type { GuardianRecoveryObservation } from '../../../../source/utils/smartAccount/guardianStatus';
import { Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const guardian = '0x2222222222222222222222222222222222222222';
const replacement = '0x3333333333333333333333333333333333333333';
const moduleAddress = '0x4444444444444444444444444444444444444444';
const separatePayer = query.has('separate-payer') || query.has('smart-guardian');
const guardianChoice: NativeGuardianRecoveryChoice = {
  id: query.has('smart-guardian') ? 'smart:60:1' : 'hd:60:0',
  address: guardian,
  label: query.has('smart-guardian') ? 'Guardian smart account' : 'Guardian wallet',
};
const replacementChoice: NativeGuardianRecoveryChoice = {
  id: 'imported:60:0',
  address: replacement,
  label: 'Replacement key',
};
const payerChoice: NativeGuardianRecoveryChoice = separatePayer
  ? { id: 'hd:60:1', address: '0x5555555555555555555555555555555555555555', label: 'Fee payer' }
  : guardianChoice;
const guardians = [guardianChoice];
const replacements = [
  ...(query.has('large')
    ? Array.from({ length: 1500 }, (_, index) => ({
        id: `hd:60:${index + 10}`,
        label: `Wallet account ${index + 10}`,
        address: '0x' + (index + 10).toString(16).padStart(40, '0'),
      }))
    : []),
  ...(query.has('smart-guardian') ? [] : [guardianChoice]),
  replacementChoice,
];
const payers = separatePayer ? [payerChoice] : [guardianChoice, replacementChoice];
const accountRef = ({ id, address }: NativeGuardianRecoveryChoice) => ({
  id,
  address,
  xpub: 'public fixture',
});
const hash = '0x' + 'ab'.repeat(32);
const events: string[] = [];
let releaseOpen: (() => void) | undefined;
let disposed = 0;
declare global {
  interface Window {
    __guardianRecoveryFixture: {
      events(): string[];
      releaseOpen(): void;
      disposed(): number;
    };
  }
}
window.__guardianRecoveryFixture = {
  events: () => [...events],
  releaseOpen: () => releaseOpen?.(),
  disposed: () => disposed,
};

const intent: NativeGuardianRecoveryIntent = {
  accountId: 'smart:60:0',
  operation: {
    account,
    chainId: 1,
    executionCalldata: '0x1234',
    hash,
    mode: '0x' + '00'.repeat(32),
    policyEpoch: '1',
    recoveryModule: moduleAddress,
    salt: '0x' + 'cd'.repeat(32),
  },
  target: { auth: { module: 'ecdsa', validator: moduleAddress, data: '0x' } },
  guardian: accountRef(guardianChoice),
  replacement: { kind: 'software', account: accountRef(replacementChoice) },
  payer: accountRef(payerChoice),
};
const observation: GuardianRecoveryObservation = {
  account,
  chainId: 1,
  moduleAddress,
  guardians: [guardian],
  guardianCount: '1',
  exists: true,
  threshold: query.has('threshold-two') ? 2 : 1,
  delay: '259200',
  delaySeconds: 259200,
  expirationSeconds: 518400,
  policyEpoch: '1',
  pending: null,
  active: null,
  knownOperation: null,
  observedBlock: { number: 100, hash, timestamp: 1794096000 },
};

export function NativeGuardianRecoveryFixture() {
  const [closed, setClosed] = useState(false);
  const [lifetime] = useState(() => new AbortController());
  if (closed) return <Text>Recovery closed</Text>;
  return (
    <NativeGuardianRecovery
      address={account}
      networkLabel="Ethereum"
      observation={observation}
      lifetime={lifetime.signal}
      onBack={() => {
        lifetime.abort();
        setClosed(true);
      }}
      recovery={{
        passkeysAvailable: false, chainId: 1,
        currency: 'ETH',
        hasIntent: query.has('resume'),
        async openRecoveryAlerts() {
          events.push('recovery-alerts');
        },
        onActivity: async (_payerId, _chainId, hash) => {
          events.push(`activity:${hash}`);
          if (query.has('handoff-fails')) throw Error('Private failure');
        },
        guardians,
        replacements,
        payers,
        async open(draft, signal, check) {
          events.push(`open:${draft.kind}`);
          if (query.has('held-open'))
            await new Promise<void>((resolve) => {
              releaseOpen = resolve;
            });
          check();
          const selectedIntent = draft.kind === 'start'
            ? {
                ...intent,
                guardian: accountRef(guardians.find(({ id }) => id === draft.guardianId)!),
                replacement: { kind: 'software' as const, account: accountRef(replacements.find(({ id }) => id === (draft.replacement.kind === 'software' ? draft.replacement.accountId : ''))!) },
                payer: accountRef(payers.find(({ id }) => id === draft.payerId)!),
              }
            : intent;
          let phase: 'new' | 'pending' | 'ready' | 'executed' = query.has(
            'executed-owner-change'
          )
            ? 'executed'
            : query.has('ready')
            ? 'ready'
            : query.has('resume')
            ? 'pending'
            : 'new';
          let transactionHash: string | null =
            phase === 'pending' || phase === 'ready' ? hash : null;
          let metadataFailed = query.has('metadata-error');
          const model = new NativeGuardianRecoveryController(
            {
              assertCurrent: check,
              dispose() {},
              submissionFailure() {
                return { transactionNotBroadcast: false };
              },
              async observe() {
                events.push('observe');
                if (
                  query.has('unknown') &&
                  events.filter((value) => value === 'observe').length > 1
                )
                  throw Error('Network status unavailable');
                const active =
                  phase === 'pending' || phase === 'ready'
                    ? {
                        operationId: hash,
                        status: phase,
                        executableAt: 1794355200,
                        expiresAt: 1794873600,
                        scheduledAt: 1794096000,
                      }
                    : null;
                return {
                  intent: selectedIntent,
                  observation: {
                    ...observation,
                    active,
                    pending: active,
                    knownOperation:
                      query.has('other-recovery') && active
                        ? { ...active, status: 'unknown' as const }
                        : active,
                  },
                  transactionHash,
                  action:
                    phase === 'ready'
                      ? 'finalize'
                      : phase === 'new'
                      ? 'schedule'
                      : null,
                  terminal: phase === 'executed' ? 'executed' : null,
                  canAbandon: true,
                };
              },
              async prepare(action: NativeGuardianRecoveryAction) {
                events.push(`review:${action}`);
                return {
                  transaction: {
                    chainId: '1',
                    from: selectedIntent.payer.address,
                    to: moduleAddress,
                    nonce: '3',
                    type: 2,
                    value: '0x0',
                    data: '0x1234',
                    gasLimit: '0x186a0',
                    maxFeePerGas: '0x3b9aca00',
                    maxPriorityFeePerGas: '0x3b9aca00',
                    accessList: [],
                  },
                  feeComparison: { recommendationOnly: true },
                  maximumFeeUnits: '100000000000000',
                  maximumTotalUnits: '100000000000000',
                  coveredFeeUnits: '0',
                  approval: null,
                  expiresAtMonotonicMilliseconds:
                    performance.now() + (query.has('expires') ? 120 : 60000),
                  async submit(guard, onBroadcast) {
                    guard();
                    events.push(`submit:${action}`);
                    onBroadcast(hash);
                    transactionHash = hash;
                    phase = action === 'finalize' ? 'executed' : 'pending';
                    return hash;
                  },
                };
              },
              async reconcile() {
                events.push('metadata');
                if (query.has('executed-owner-change'))
                  throw Error('Recovery owner changed after execution');
                if (metadataFailed) {
                  metadataFailed = false;
                  throw Error('Metadata read unavailable');
                }
              },
              async abandon() {
                events.push('abandon');
              },
            },
            signal
          );
          const dispose = model.dispose.bind(model);
          model.dispose = () => {
            disposed++;
            dispose();
          };
          return model;
        },
      }}
    />
  );
}
