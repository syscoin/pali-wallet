jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({ vault: { activeNetwork: { chainId: 57057 } } }),
  },
}));
jest.mock('state/vault', () => ({ setAccountPropertyByIdAndType: jest.fn() }));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  aggregateContractCalls: jest.fn(),
}));

import { Contract, getAddress } from 'utils/ethersV6Compat';
import {
  aggregateContractCalls,
  ERC7579_MODE_SINGLE_DEFAULT,
  getConfiguredAuthenticatorAddress,
  getSmartAccountGuardianRecoveryHash,
  SmartAccountGuardianRecoveryOperation,
} from 'utils/smartAccount';
import { GuardianRecoveryPolicyChangedError } from 'utils/smartAccountErrors';

import SmartAccountController from './index';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const GUARDIAN = '0x4444444444444444444444444444444444444444';
const MODULE = getAddress(
  getConfiguredAuthenticatorAddress(57057, 'guardian-recovery')
);
const makeOperation = (): SmartAccountGuardianRecoveryOperation => {
  const intent = {
    account: ACCOUNT,
    chainId: 57057,
    executionCalldata: '0x1234',
    mode: ERC7579_MODE_SINGLE_DEFAULT,
    policyEpoch: '7',
    recoveryModule: MODULE,
    salt: `0x${'00'.repeat(32)}`,
  };
  return { ...intent, hash: getSmartAccountGuardianRecoveryHash(intent) };
};

describe('guardian recovery policy freshness', () => {
  let controller: any;
  let policyEpoch: jest.Mock;
  let getRecoveryScheduleHash: jest.Mock;
  let sign: jest.Mock;
  let send: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    policyEpoch = jest.fn().mockResolvedValue('7');
    getRecoveryScheduleHash = jest.fn().mockResolvedValue(makeOperation().hash);
    (Contract as unknown as jest.Mock).mockImplementation(() => ({
      policyEpoch,
      getRecoveryScheduleHash,
    }));
    sign = jest.fn().mockResolvedValue('0x1234');
    send = jest.fn().mockResolvedValue({ wait: jest.fn() });
    controller = new SmartAccountController({
      getEthereumTransaction: () => ({ web3Provider: {} }),
      sendAndSaveEthTransaction: send,
      signSmartAccountActionDigestInternal: sign,
    } as any);
    controller.getGuardianRecoveryStatusForAccount = jest
      .fn()
      .mockResolvedValue({ moduleAddress: MODULE });
    controller.getWalletGasPayerAccount = jest
      .fn()
      .mockResolvedValue({ id: 1, type: 'HDAccount', address: GUARDIAN });
  });

  it('checks imported epoch and independently recomputes the on-chain digest', async () => {
    const operation = JSON.parse(JSON.stringify(makeOperation()));
    await expect(
      controller.validateSmartAccountGuardianRecoveryOperation({
        account: ACCOUNT,
        operation,
      })
    ).resolves.toBeUndefined();
    expect(policyEpoch).toHaveBeenCalledWith(ACCOUNT);
    expect(getRecoveryScheduleHash).toHaveBeenCalledWith(
      ACCOUNT,
      operation.salt,
      operation.mode,
      operation.executionCalldata
    );
  });

  it.each([
    ['epoch', { policyEpoch: '6' }],
    ['missing epoch', { policyEpoch: undefined }],
    ['account', { account: GUARDIAN }],
    ['chain', { chainId: 1 }],
    ['missing chain', { chainId: undefined }],
    ['hash', { hash: `0x${'11'.repeat(32)}` }],
  ])('rejects invalid imported %s before submitting', async (_, change) => {
    await expect(
      controller.submitPreparedSmartAccountGuardianStartRecovery({
        account: ACCOUNT,
        guardian: GUARDIAN,
        approval: { guardian: GUARDIAN, signature: '0x1234' },
        operation: { ...makeOperation(), ...change },
      })
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed when the epoch RPC fails', async () => {
    policyEpoch.mockRejectedValue(new Error('RPC unavailable'));
    await expect(
      controller.validateSmartAccountGuardianRecoveryOperation({
        account: ACCOUNT,
        operation: makeOperation(),
      })
    ).rejects.toThrow('RPC unavailable');
  });

  it('fails closed if the policy changes between epoch and digest reads', async () => {
    getRecoveryScheduleHash.mockResolvedValue(
      getSmartAccountGuardianRecoveryHash({
        ...makeOperation(),
        policyEpoch: '8',
      })
    );
    await expect(
      controller.validateSmartAccountGuardianRecoveryOperation({
        account: ACCOUNT,
        operation: makeOperation(),
      })
    ).rejects.toThrow('digest does not match');
  });

  it('rejects removed or replaced recovery modules', async () => {
    controller.getGuardianRecoveryStatusForAccount.mockResolvedValue(null);
    await expect(
      controller.validateSmartAccountGuardianRecoveryOperation({
        account: ACCOUNT,
        operation: makeOperation(),
      })
    ).rejects.toThrow('not installed');
  });

  it('rechecks policy after target ownership proof and before guardian signing', async () => {
    controller.buildGuardianStartRecoveryOperation = jest
      .fn()
      .mockResolvedValue(makeOperation());
    controller.proveRecoveryTargetOwnership = jest
      .fn()
      .mockImplementation(async () => {
        policyEpoch.mockResolvedValue('8');
      });
    controller.findLocalSigningAccount = jest
      .fn()
      .mockReturnValue({ id: 1, type: 'HDAccount' });
    await expect(
      controller.prepareSmartAccountGuardianStartRecovery({
        account: ACCOUNT,
        guardian: GUARDIAN,
        target: {},
      })
    ).rejects.toThrow(GuardianRecoveryPolicyChangedError);
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects a stale persisted epoch before finalizing', async () => {
    policyEpoch.mockResolvedValue('8');
    await expect(
      controller.finalizeSmartAccountGuardianRecovery(makeOperation())
    ).rejects.toThrow(GuardianRecoveryPolicyChangedError);
    expect(send).not.toHaveBeenCalled();
  });

  it('submits the unchanged schedule ABI after current policy validation', async () => {
    await controller.submitPreparedSmartAccountGuardianStartRecovery({
      account: ACCOUNT,
      guardian: GUARDIAN,
      approval: { guardian: GUARDIAN, signature: '0x1234' },
      operation: makeOperation(),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe(MODULE);
  });
});

describe('guardian recovery installed policy discovery', () => {
  const aggregate = aggregateContractCalls as jest.Mock;
  let controller: any;

  beforeEach(() => {
    aggregate.mockReset();
    controller = new SmartAccountController({
      getEthereumTransaction: () => ({ web3Provider: {} }),
    } as any);
  });

  it('does not query an uninstalled recovery module', async () => {
    aggregate.mockResolvedValueOnce([{ success: true, result: [false] }]);
    await expect(
      controller.getSmartAccountGuardianRecoveryStatus({ account: ACCOUNT })
    ).resolves.toBeNull();
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it('propagates failed installation checks', async () => {
    aggregate.mockResolvedValueOnce([{ success: false }]);
    await expect(
      controller.getSmartAccountGuardianRecoveryStatus({ account: ACCOUNT })
    ).rejects.toThrow('installation');
  });

  it('fails closed when an installed policy cannot be read', async () => {
    aggregate.mockResolvedValueOnce([{ success: true, result: [true] }]);
    aggregate.mockResolvedValueOnce([{ success: false }, { success: false }]);
    await expect(
      controller.getSmartAccountGuardianRecoveryStatus({ account: ACCOUNT })
    ).rejects.toThrow('config');
  });
});
