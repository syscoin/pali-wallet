jest.mock('../utils/smartAccount/guardianStatus', () => ({
  readGuardianRecoveryObservation: jest.fn(),
}));

import { getPaliModuleAddress } from '../utils/smartAccount/contracts';
import { readGuardianRecoveryObservation } from '../utils/smartAccount/guardianStatus';

import { observeGuardianActivity } from './guardianActivityObservation';

const scope = {
  accountAddress: `0x${'11'.repeat(20)}`,
  accountId: 'account-1',
  accountType: 'software',
  chainId: '1',
  networkKey: 'https://rpc.example',
  networkType: 'evm' as const,
};

beforeEach(() => jest.clearAllMocks());

it('delegates transport and the tracked operation to the existing anchored reader with the registry module', async () => {
  const provider = { send: jest.fn() };
  const assertCurrent = jest.fn();
  const now = () => 123;
  const knownOperationId = `0x${'ab'.repeat(32)}`;
  const observation = { account: scope.accountAddress };
  jest
    .mocked(readGuardianRecoveryObservation)
    .mockResolvedValue(observation as any);
  expect(
    await observeGuardianActivity({
      scope,
      provider,
      knownOperationId,
      assertCurrent,
      now,
    })
  ).toBe(observation);
  expect(readGuardianRecoveryObservation).toHaveBeenCalledWith({
    account: scope.accountAddress,
    chainId: 1,
    moduleAddress: getPaliModuleAddress(1, 'guardian-recovery'),
    provider,
    knownOperationId,
    assertCurrent,
    now,
  });
});

it('does not read guardian state on a UTXO network or unsafe EVM chain', async () => {
  const provider = { send: jest.fn() };
  await expect(
    observeGuardianActivity({
      scope: { ...scope, networkType: 'utxo' },
      provider,
    })
  ).rejects.toThrow('EVM account');
  await expect(
    observeGuardianActivity({
      scope: { ...scope, chainId: '9007199254740993' },
      provider,
    })
  ).rejects.toThrow('EVM account');
  expect(readGuardianRecoveryObservation).not.toHaveBeenCalled();
});
