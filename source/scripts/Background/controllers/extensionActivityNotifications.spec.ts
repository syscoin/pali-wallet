import { getPaliModuleAddress } from '../../../utils/smartAccount/contracts';

import { ExtensionActivityNotifications } from './extensionActivityNotifications';
import type { GuardianRecoveryObservation } from '../../../utils/smartAccount/guardianStatus';

const account = `0x${'11'.repeat(20)}`;
const external = `0x${'22'.repeat(20)}`;
const scope = {
  accountAddress: account,
  accountId: '0',
  accountType: 'SmartAccount',
  chainId: '1',
  networkKey: 'https://rpc.example',
  networkType: 'evm' as const,
};
const operationId = `0x${'ab'.repeat(32)}`;
const observation = (
  status?: 'pending' | 'executed' | 'canceled'
): GuardianRecoveryObservation => {
  const operation = status
    ? { operationId, status, scheduledAt: 10, executableAt: 20, expiresAt: 30 }
    : null;
  return {
    account,
    chainId: 1,
    moduleAddress: getPaliModuleAddress(1, 'guardian-recovery'),
    exists: true,
    guardians: [external],
    guardianCount: '1',
    threshold: 1,
    delay: '10',
    delaySeconds: 10,
    expirationSeconds: 10,
    policyEpoch: '1',
    observedBlock: {
      number: 100,
      hash: `0x${'cc'.repeat(32)}`,
      timestamp: 100,
    },
    active: status === 'pending' ? operation : null,
    pending: status === 'pending' ? operation : null,
    knownOperation: operation,
  };
};

it('keeps an initialized empty account, discovers externally signed activity, and deduplicates confirmation', () => {
  const observer = new ExtensionActivityNotifications();
  const deliver = jest.fn();
  const base = {
    scope,
    namespace: 1,
    isCurrent: () => true,
    previousTransactions: [],
    deliver,
  };
  observer.history({ ...base, transactions: [] });
  const incoming = {
    hash: `0x${'aa'.repeat(32)}`,
    from: external,
    to: account,
  };
  const outgoing = {
    hash: `0x${'bb'.repeat(32)}`,
    from: account,
    to: external,
  };
  observer.history({ ...base, transactions: [incoming, outgoing] });
  expect(deliver.mock.calls.map(([fact]) => fact.direction)).toEqual([
    'incoming',
    'outgoing',
  ]);
  const confirmed = { ...incoming, blockNumber: 101, status: 1 };
  observer.history({ ...base, transactions: [confirmed, outgoing] });
  observer.history({ ...base, transactions: [confirmed, outgoing] });
  expect(deliver.mock.calls.map(([fact]) => fact.kind)).toEqual([
    'transaction-pending',
    'transaction-pending',
    'transaction-confirmed',
  ]);
});

it('seeds existing history without hiding its first pending-to-confirmed transition', () => {
  const observer = new ExtensionActivityNotifications();
  const deliver = jest.fn();
  const pending = { hash: `0x${'aa'.repeat(32)}`, from: account, to: external };
  observer.history({
    scope,
    namespace: 1,
    isCurrent: () => true,
    previousTransactions: [pending],
    transactions: [{ ...pending, blockNumber: 100, status: 1 }],
    deliver,
  });
  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'transaction-confirmed' })
  );
});

it.each(['executed', 'canceled'] as const)(
  'observes external recovery and follows its operation through %s without a signed local attempt',
  async (status) => {
    const observer = new ExtensionActivityNotifications();
    const deliver = jest.fn();
    const read = jest
      .fn()
      .mockResolvedValueOnce(observation())
      .mockResolvedValueOnce(observation('pending'))
      .mockResolvedValueOnce(observation(status));
    const input = { scope, namespace: 1, isCurrent: () => true, read, deliver };
    await observer.guardian(input);
    expect(deliver).not.toHaveBeenCalled();
    await observer.guardian(input);
    await observer.guardian(input);
    expect(read).toHaveBeenNthCalledWith(3, operationId);
    expect(deliver.mock.calls.map(([fact]) => fact.kind)).toEqual([
      'recovery-started',
      status === 'executed' ? 'recovery-completed' : 'recovery-cancelled',
    ]);
    expect(
      deliver.mock.calls.every(([fact]) => fact.evidence === 'observed-state')
    ).toBe(true);
  }
);

it('rejects an in-flight old-wallet observation before committing or notifying', async () => {
  const observer = new ExtensionActivityNotifications();
  let current = true;
  let finish!: (value: GuardianRecoveryObservation) => void;
  const read = () =>
    new Promise<GuardianRecoveryObservation>((resolve) => {
      finish = resolve;
    });
  const deliver = jest.fn();
  const pending = observer.guardian({
    scope,
    namespace: 1,
    isCurrent: () => current,
    read,
    deliver,
  });
  current = false;
  finish(observation('executed'));
  await pending;
  expect(deliver).not.toHaveBeenCalled();
  await observer.guardian({
    scope,
    namespace: 2,
    isCurrent: () => true,
    read: async () => observation('pending'),
    deliver,
  });
  expect(deliver).not.toHaveBeenCalled();
});
