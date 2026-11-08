jest.mock('state/store', () => ({
  persistSmartAccountMetadata: jest.fn(async (id, prepare, check) => {
    check();
    const next = prepare();
    check();
    mockState.vault.accounts.SmartAccount[id].smartAccount = next;
  }),
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => mockState,
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

import { guardianRecoveryFixture } from 'tests/fixtures/guardianRecoveryClaim';

import { Contract, getAddress } from 'utils/ethersV6Compat';
import {
  aggregateContractCalls,
  buildSmartAccountGuardianRecoveryOperation,
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
  getSmartAccountGuardianRecoveryHash,
  SmartAccountGuardianRecoveryOperation,
} from 'utils/smartAccount';
import { GuardianRecoveryPolicyChangedError } from 'utils/smartAccountErrors';

import SmartAccountController from './index';

let mockState: any;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const GUARDIAN = '0x4444444444444444444444444444444444444444';
const MODULE = getAddress(
  getConfiguredAuthenticatorAddress(57057, 'guardian-recovery')
);
const claimFixture = () => guardianRecoveryFixture(ACCOUNT, GUARDIAN);
const makeOperation = (): SmartAccountGuardianRecoveryOperation =>
  claimFixture().operation;

describe('guardian recovery policy freshness', () => {
  let controller: any;
  let policyEpoch: jest.Mock;
  let getRecoveryScheduleHash: jest.Mock;
  let sign: jest.Mock;
  let send: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      vault: {
        activeNetwork: {
          chainId: 57057,
          kind: 'ethereum',
          url: 'https://fixture.invalid',
        },
        activeAccount: { id: 1, type: 'HDAccount' },
        accounts: {
          HDAccount: { 1: { address: GUARDIAN } },
          SmartAccount: {
            0: {
              id: 0,
              address: ACCOUNT,
              isSmartAccount: true,
              smartAccount: {
                chainId: 57057,
                guardianRecoveryClaim: claimFixture().claim,
              },
            },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    policyEpoch = jest.fn().mockResolvedValue('7');
    getRecoveryScheduleHash = jest.fn().mockResolvedValue(makeOperation().hash);
    (Contract as unknown as jest.Mock).mockImplementation(() => ({
      policyEpoch,
      getRecoveryScheduleHash,
    }));
    sign = jest.fn().mockResolvedValue('0x1234');
    send = jest.fn().mockResolvedValue({ wait: jest.fn() });
    const transaction = { web3Provider: {} };
    controller = new SmartAccountController({
      captureSmartAccountPendingRecords: async () => ({
        profileId: '0x' + '11'.repeat(32),
        read: async () => [],
      }),
      getEthereumTransaction: () => transaction,
      getWalletStateGeneration: () => 1,
      sendAndSaveEthTransaction: send,
      signSmartAccountActionDigestInternal: sign,
    } as any);
    controller.getGuardianRecoveryStatusForAccount = jest
      .fn()
      .mockResolvedValue({ moduleAddress: MODULE });
    controller.getSmartAccountGuardianRecoveryStatus = jest.fn(async () => ({
      recoveryTransactionHash: null,
    }));
    controller.getWalletGasPayerAccount = jest
      .fn()
      .mockResolvedValue({ id: 1, type: 'HDAccount', address: GUARDIAN });
  });

  it('builds recovery from the actual active validator when saved metadata is stale', async () => {
    const active = '0x7777777777777777777777777777777777777777';
    const validator = getConfiguredAuthenticatorAddress(57057, 'ecdsa');
    const target = {
      auth: {
        module: 'ecdsa' as const,
        validator,
        data: encodeEcdsaValidatorInitData([GUARDIAN], 1),
      },
    };
    (Contract as unknown as jest.Mock).mockImplementation(() => ({
      policyEpoch,
      activeValidator: jest.fn(async () => active),
      isModuleInstalled: jest.fn(
        async (_type, address) => address.toLowerCase() === active.toLowerCase()
      ),
    }));
    const saved = {
      account: { id: 0, address: ACCOUNT, type: 'SmartAccount' },
      metadata: { chainId: 57057, auth: { validator: GUARDIAN } },
    };
    controller.getActiveSmartAccount = jest.fn(() => saved);
    const operation = await controller.buildGuardianStartRecoveryOperation(
      ACCOUNT,
      target
    );
    expect(operation).toEqual(
      buildSmartAccountGuardianRecoveryOperation({
        account: ACCOUNT,
        chainId: 57057,
        policyEpoch: '7',
        recoveryModule: MODULE,
        salt: operation.salt,
        target,
        replaceExistingValidator: false,
        revokeValidator: active,
      })
    );
    expect(controller.getActiveSmartAccount).toHaveBeenCalled();
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
        claimHash: makeOperation().hash,
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
    mockState.vault.accounts.SmartAccount[0].smartAccount.guardianRecoveryClaim =
      undefined;
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
        expectedClaimHash: null,
        readyAt: 1,
        replacement: claimFixture().replacement,
        operation: null,
        account: ACCOUNT,
        guardian: GUARDIAN,
        target: {
          auth: {
            module: 'ecdsa',
            validator: getConfiguredAuthenticatorAddress(57057, 'ecdsa'),
            data: claimFixture().target.auth.data,
          },
        },
      })
    ).rejects.toThrow(GuardianRecoveryPolicyChangedError);
    expect(sign).not.toHaveBeenCalled();
  });

  it('resumes only the supplied canonical operation without allocating another salt', async () => {
    const target = {
      auth: {
        module: 'ecdsa' as const,
        validator: getConfiguredAuthenticatorAddress(57057, 'ecdsa'),
        data: encodeEcdsaValidatorInitData([GUARDIAN], 1),
      },
    };
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: 57057,
      policyEpoch: '7',
      recoveryModule: MODULE,
      salt: `0x${'77'.repeat(32)}`,
      target,
    });
    getRecoveryScheduleHash.mockResolvedValue(operation.hash);
    controller.proveRecoveryTargetOwnership = jest.fn(async () => undefined);
    controller.findLocalSigningAccount = jest.fn(() => ({
      id: 1,
      type: 'HDAccount',
    }));
    controller.buildGuardianStartRecoveryOperation = jest.fn();
    mockState.vault.accounts.SmartAccount[0].smartAccount.guardianRecoveryClaim =
      undefined;
    const prepared = await controller.prepareSmartAccountGuardianStartRecovery({
      expectedClaimHash: null,
      readyAt: 1,
      replacement: claimFixture().replacement,
      account: ACCOUNT,
      guardian: GUARDIAN,
      operation,
      target,
    });
    expect(prepared.operation).toEqual(operation);
    expect(
      controller.buildGuardianStartRecoveryOperation
    ).not.toHaveBeenCalled();
    expect(sign).toHaveBeenCalledWith(
      [GUARDIAN, operation.hash],
      { id: 1, type: 'HDAccount' },
      expect.any(String)
    );
  });

  it.each(['account', 'chain', 'replacement', 'missing operation'])(
    'rejects a resumed %s mismatch before ownership or guardian signing',
    async (axis) => {
      const target = {
        auth: {
          module: 'ecdsa' as const,
          validator: getConfiguredAuthenticatorAddress(57057, 'ecdsa'),
          data: encodeEcdsaValidatorInitData([GUARDIAN], 1),
        },
      };
      const operation = buildSmartAccountGuardianRecoveryOperation({
        account: axis === 'account' ? GUARDIAN : ACCOUNT,
        chainId: axis === 'chain' ? 1 : 57057,
        policyEpoch: '7',
        recoveryModule: MODULE,
        salt: `0x${'77'.repeat(32)}`,
        target,
      });
      controller.proveRecoveryTargetOwnership = jest.fn();
      await expect(
        controller.prepareSmartAccountGuardianStartRecovery({
          expectedClaimHash: null,
          readyAt: 1,
          replacement: claimFixture().replacement,
          account: ACCOUNT,
          guardian: GUARDIAN,
          operation: axis === 'missing operation' ? undefined : operation,
          target:
            axis === 'replacement'
              ? {
                  auth: {
                    ...target.auth,
                    data: encodeEcdsaValidatorInitData([ACCOUNT], 1),
                  },
                }
              : target,
        })
      ).rejects.toThrow();
      expect(controller.proveRecoveryTargetOwnership).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it('rejects a stale persisted epoch before finalizing', async () => {
    policyEpoch.mockResolvedValue('8');
    await expect(
      controller.finalizeSmartAccountGuardianRecovery({
        claim: claimFixture().claim,
        expectedClaimHash: null,
      })
    ).rejects.toThrow(GuardianRecoveryPolicyChangedError);
    expect(send).not.toHaveBeenCalled();
  });

  it('submits the unchanged schedule ABI after current policy validation', async () => {
    await controller.submitPreparedSmartAccountGuardianStartRecovery({
      claimHash: makeOperation().hash,
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
      captureSmartAccountPendingRecords: async () => ({
        profileId: '0x' + '11'.repeat(32),
        read: async () => [],
      }),
      getEthereumTransaction: () => ({ web3Provider: {} }),
    } as any);
  });

  it('does not query an uninstalled recovery module', async () => {
    aggregate.mockResolvedValueOnce([{ success: true, result: [false] }]);
    await expect(
      controller.getGuardianRecoveryStatusForAccount(ACCOUNT)
    ).resolves.toBeNull();
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it('propagates failed installation checks', async () => {
    aggregate.mockResolvedValueOnce([{ success: false }]);
    await expect(
      controller.getGuardianRecoveryStatusForAccount(ACCOUNT)
    ).rejects.toThrow('installation');
  });

  it('fails closed when an installed policy cannot be read', async () => {
    aggregate.mockResolvedValueOnce([{ success: true, result: [true] }]);
    aggregate.mockResolvedValueOnce([{ success: false }, { success: false }]);
    await expect(
      controller.getGuardianRecoveryStatusForAccount(ACCOUNT)
    ).rejects.toThrow('config');
  });
});
