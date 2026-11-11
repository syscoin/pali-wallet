import { getPaliModuleAddress } from '../utils/smartAccount/contracts';

import {
  activityNotificationScopeKey,
  decodeActivityNotificationBaseline,
  detectActivityNotifications,
  type ActivityNotificationBaseline,
  type ActivityNotificationScope,
} from './activityNotifications';
import type { GuardianRecoveryObservation } from '../utils/smartAccount/guardianStatus';

const account = `0x${'11'.repeat(20)}`;
const external = `0x${'22'.repeat(20)}`;
const txHash = `0x${'aa'.repeat(32)}`;
const operationId = `0x${'ab'.repeat(32)}`;
const scope: ActivityNotificationScope = {
  accountAddress: account,
  accountId: 'account-1',
  accountType: 'software',
  chainId: '1',
  networkKey: 'https://rpc.example',
  networkType: 'evm',
};
const incoming = { hash: txHash, from: external, to: account, chainId: 1 };
const poll = (
  previous: ActivityNotificationBaseline | null,
  transactions: unknown[],
  overrides: Partial<Parameters<typeof detectActivityNotifications>[0]> = {}
) =>
  detectActivityNotifications({
    scope,
    previous,
    transactions,
    observedAt: 100000,
    ...overrides,
  });
const guardian = (
  overrides: Partial<GuardianRecoveryObservation> = {}
): GuardianRecoveryObservation => ({
  account,
  chainId: 1,
  moduleAddress: getPaliModuleAddress(1, 'guardian-recovery'),
  active: null,
  pending: null,
  knownOperation: null,
  exists: true,
  delay: '10',
  delaySeconds: 10,
  expirationSeconds: 50,
  guardians: [external],
  guardianCount: '1',
  threshold: 1,
  policyEpoch: '1',
  observedBlock: { number: 10, hash: `0x${'01'.repeat(32)}`, timestamp: 100 },
  ...overrides,
});
const operation = (
  status: 'pending' | 'executed' | 'canceled' | 'expired'
) => ({
  operationId,
  status,
  scheduledAt: 100,
  executableAt: 110,
  expiresAt: 160,
});

it('suppresses first-sync backlog but alerts the first incoming after an empty baseline', () => {
  expect(
    poll(null, [{ ...incoming, blockNumber: 1, status: 1 }]).facts
  ).toEqual([]);
  const first = poll(null, []);
  expect(
    poll(first.baseline, [
      { ...incoming, blockNumber: 1, timestamp: 1, status: 1 },
    ]).facts[0].kind
  ).toBe('transaction-confirmed');
  const next = poll(first.baseline, [incoming]);
  expect(next.facts).toEqual([
    expect.objectContaining({
      kind: 'transaction-pending',
      direction: 'incoming',
      evidence: 'pending-intent',
      transactionHash: txHash,
    }),
  ]);
  expect(poll(next.baseline, [incoming]).facts).toEqual([]);
});

it('derives outgoing involvement from the observed account even when another device signed', () => {
  const first = poll(null, []);
  expect(
    poll(first.baseline, [{ ...incoming, from: account, to: external }])
      .facts[0]
  ).toMatchObject({
    kind: 'transaction-pending',
    direction: 'outgoing',
  });
  expect(
    poll(first.baseline, [{ ...incoming, from: external, to: external }]).facts
  ).toEqual([]);
});

it('deduplicates the same transaction across feeds and keeps an explicit failure', () => {
  const first = poll(null, [incoming]);
  const next = poll(first.baseline, [
    { ...incoming, blockNumber: 11, status: 1 },
    { ...incoming, blockNumber: 11, status: 0 },
  ]);
  expect(next.facts).toHaveLength(1);
  expect(next.facts[0]).toMatchObject({
    kind: 'transaction-failed',
    evidence: 'observed-state',
  });
});

it('does not call missing receipt status success and never re-alerts after a reorg regression', () => {
  const first = poll(null, [incoming]);
  const unknown = poll(first.baseline, [{ ...incoming, blockNumber: 11 }]);
  expect(unknown.facts[0].kind).toBe('transaction-status-unknown');
  const success = poll(unknown.baseline, [
    { ...incoming, blockNumber: 11, status: '0x1' },
  ]);
  expect(success.facts[0].kind).toBe('transaction-confirmed');
  const regressed = poll(success.baseline, [incoming]);
  expect(regressed.facts).toEqual([]);
  expect(
    poll(regressed.baseline, [{ ...incoming, blockNumber: 12, status: 1 }])
      .facts
  ).toEqual([]);
  const initiallyMined = poll(null, [
    { ...incoming, blockNumber: 10, status: 1 },
  ]);
  const oldRegressed = poll(initiallyMined.baseline, [incoming]);
  expect(
    poll(oldRegressed.baseline, [{ ...incoming, blockNumber: 12, status: 1 }])
      .facts
  ).toEqual([]);
});

it('preserves a successful empty baseline over failed or oversized reads', () => {
  const first = poll(null, []);
  const failed = poll(first.baseline, [incoming], {
    historyReadSucceeded: false,
  });
  expect(failed.facts).toEqual([]);
  expect(failed.baseline).toEqual(first.baseline);
  const oversized = poll(first.baseline, Array(2049).fill(incoming));
  expect(oversized.baseline).toEqual(first.baseline);
  expect(poll(failed.baseline, [incoming]).facts).toHaveLength(1);
  expect(
    poll(null, [], { historyReadSucceeded: false }).baseline.historyInitialized
  ).toBe(false);
});

it('silently rebases on account, endpoint or chain changes and rejects corrupted baselines', () => {
  const first = poll(null, []);
  for (const changed of [
    { ...scope, accountId: 'another' },
    { ...scope, networkKey: 'https://other.example' },
    { ...scope, chainId: '2' },
  ]) {
    expect(poll(first.baseline, [incoming], { scope: changed }).facts).toEqual(
      []
    );
    expect(activityNotificationScopeKey(changed)).not.toBe(
      activityNotificationScopeKey(scope)
    );
  }
  expect(
    decodeActivityNotificationBaseline(
      { ...first.baseline, deliveredKeys: Array(4097).fill('x') },
      scope
    )
  ).toBeNull();
  expect(
    decodeActivityNotificationBaseline(
      { ...first.baseline, transactions: [{ hash: txHash }] },
      scope
    )
  ).toBeNull();
  expect(
    decodeActivityNotificationBaseline(
      JSON.parse(JSON.stringify(first.baseline)),
      scope
    )
  ).toEqual(first.baseline);
});

it('suppresses newly discovered old pages while preserving a tracked pending confirmation', () => {
  const first = poll(null, [{ ...incoming, blockNumber: 10, status: 1 }]);
  expect(
    poll(first.baseline, [
      { ...incoming, hash: `0x${'bb'.repeat(32)}`, blockNumber: 9, status: 1 },
    ]).facts
  ).toEqual([]);
  expect(
    poll(first.baseline, [
      {
        ...incoming,
        hash: `0x${'cc'.repeat(32)}`,
        blockNumber: 11,
        timestamp: 99,
        status: 1,
      },
    ]).facts
  ).toEqual([]);
  const pending = poll(null, [incoming]);
  expect(
    poll(pending.baseline, [
      { ...incoming, blockNumber: 11, timestamp: 99, status: 1 },
    ]).facts[0].kind
  ).toBe('transaction-confirmed');
});

it('handles raw xpub ownership and the native projection without requiring one fixed receive address', () => {
  const utxoScope = {
    ...scope,
    accountAddress: 'first-receive-address',
    networkType: 'utxo' as const,
  };
  const first = poll(null, [], { scope: utxoScope });
  const raw = {
    txid: 'ab'.repeat(32),
    blockHeight: 11,
    addressValueIn: '0',
    addressValueOut: '100',
  };
  expect(
    poll(first.baseline, [raw], { scope: utxoScope }).facts[0]
  ).toMatchObject({ kind: 'transaction-confirmed', direction: 'incoming' });
  const projected = {
    txid: 'bc'.repeat(32),
    block: { height: 11, hash: 'cd'.repeat(32), timestamp: 101 },
    netUnits: '-10',
    receivedUnits: '10',
    spentUnits: '20',
  };
  expect(
    poll(first.baseline, [projected], { scope: utxoScope }).facts[0]
  ).toMatchObject({ direction: 'outgoing', blockNumber: 11 });
});

it('baselines guardian state independently, then reports started and anchored terminal observations', () => {
  const first = poll(null, [], { guardianObservation: guardian() });
  expect(first.facts).toEqual([]);
  const started = poll(first.baseline, [], {
    guardianObservation: guardian({ active: operation('pending') }),
  });
  expect(started.facts[0]).toMatchObject({
    kind: 'recovery-started',
    evidence: 'observed-state',
    operationId,
  });
  for (const [status, kind] of [
    ['executed', 'recovery-completed'],
    ['canceled', 'recovery-cancelled'],
    ['expired', 'recovery-expired'],
  ] as const) {
    const result = poll(started.baseline, [], {
      guardianObservation: guardian({ knownOperation: operation(status) }),
    });
    expect(result.facts).toEqual([
      expect.objectContaining({
        kind,
        evidence: 'observed-state',
        operationId,
      }),
    ]);
    expect(
      poll(result.baseline, [], {
        guardianObservation: guardian({ knownOperation: operation(status) }),
      }).facts
    ).toEqual([]);
  }
});

it('rejects wrong module/account/chain and conflicting anchors without lifecycle success', () => {
  const first = poll(null, [], {
    guardianObservation: guardian({ active: operation('pending') }),
  });
  for (const observation of [
    guardian({ account: external, knownOperation: operation('executed') }),
    guardian({
      moduleAddress: external,
      knownOperation: operation('executed'),
    }),
    guardian({ chainId: 2, knownOperation: operation('executed') }),
    guardian({
      observedBlock: {
        number: 10,
        hash: `0x${'02'.repeat(32)}`,
        timestamp: 100,
      },
      knownOperation: operation('executed'),
    }),
  ])
    expect(
      poll(first.baseline, [], { guardianObservation: observation }).facts
    ).toEqual([]);
});

it('treats policy changes as observed state and never turns calldata or outer success into a recovery claim', () => {
  const first = poll(null, [], { guardianObservation: guardian() });
  const result = poll(
    first.baseline,
    [
      {
        ...incoming,
        blockNumber: 11,
        status: 1,
        input: '0xdeadbeef',
        recoveryCompleted: true,
      },
    ],
    {
      guardianObservation: guardian({ policyEpoch: '2' }),
    }
  );
  expect(result.facts.map((fact) => fact.kind)).toEqual([
    'transaction-confirmed',
    'guardian-policy-changed',
  ]);
  expect(result.facts.every((fact) => fact.evidence === 'observed-state')).toBe(
    true
  );
});
