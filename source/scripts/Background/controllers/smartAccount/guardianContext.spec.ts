jest.mock('state/store', () => ({
  persistSmartAccountMetadata: jest.fn(async (id, prepare, check) => {
    check();
    const next = prepare();
    check();
    mockState.vault.accounts.SmartAccount[id].smartAccount = next;
  }),
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));

import { guardianRecoveryFixture } from 'tests/fixtures/guardianRecoveryClaim';

import { INetworkType, KeyringAccountType } from 'types/network';
import {
  getConfiguredAuthenticatorAddress,
  getPaliErc7739PersonalSignHash,
  paliGuardianRecoveryModuleInterface,
} from 'utils/smartAccount';

import SmartAccountController from './index';

let mockState: any;
const TARGET = `0x${'11'.repeat(20)}`;
const ACTIVE = `0x${'22'.repeat(20)}`;
const GUARDIAN = `0x${'33'.repeat(20)}`;
const HASH = `0x${'44'.repeat(32)}`;
const recoveryFixture = guardianRecoveryFixture(TARGET, GUARDIAN);
const operation = recoveryFixture.operation;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('guardian recovery originating wallet context', () => {
  let generation: number;
  let controller: any;
  let sign: jest.Mock;
  let send: jest.Mock;
  const expectedContext = {
    account: { id: 0, type: KeyringAccountType.HDAccount, address: ACTIVE },
    chainId: 57057,
    rpcUrl: 'https://fixture.invalid',
    slip44: 60,
    sessionGeneration: 9,
  };
  const prepare = () => {
    mockState.vault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim =
      undefined;
    return controller.prepareSmartAccountGuardianStartRecovery({
      expectedClaimHash: null,
      readyAt: 1,
      replacement: recoveryFixture.replacement,
      operation: null,
      account: TARGET,
      guardian: GUARDIAN,
      target: {
        auth: {
          module: 'ecdsa',
          validator: getConfiguredAuthenticatorAddress(57057, 'ecdsa'),
          data: recoveryFixture.target.auth.data,
        },
      },
      expectedContext,
    });
  };
  const submit = () =>
    controller.submitPreparedSmartAccountGuardianStartRecovery({
      claimHash: operation.hash,
      account: TARGET,
      guardian: GUARDIAN,
      approval: { guardian: GUARDIAN, signature: '0x1234' },
      operation,
      expectedContext,
    });
  const finalize = () =>
    controller.finalizeSmartAccountGuardianRecovery({
      claim:
        mockState.vault.accounts.SmartAccount[1].smartAccount
          .guardianRecoveryClaim,
      expectedClaimHash: operation.hash,
      expectedContext,
    });
  beforeEach(() => {
    generation = 9;
    mockState = {
      vault: {
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          chainId: 57057,
          kind: INetworkType.Ethereum,
          url: 'https://fixture.invalid',
        },
        accounts: {
          SmartAccount: {
            1: {
              id: 1,
              address: TARGET,
              isSmartAccount: true,
              smartAccount: {
                chainId: 57057,
                guardianRecoveryClaim: recoveryFixture.claim,
              },
            },
          },
          HDAccount: { 0: { address: ACTIVE }, 2: { address: GUARDIAN } },
        },
        isBitcoinBased: false,
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    const transaction = { web3Provider: {} };
    sign = jest.fn(async () => '0x1234');
    send = jest.fn(async (_tx, _legacy, _payer, _metadata, options) => {
      options.assertCurrentContext?.();
      return { hash: HASH, wait: async () => undefined };
    });
    controller = new SmartAccountController({
      captureSmartAccountPendingRecords: async () => ({
        profileId: '0x' + '11'.repeat(32),
        read: async () => [],
      }),
      getEthereumTransaction: () => transaction,
      getWalletSessionGeneration: () => generation,
      getWalletStateGeneration: () => generation,
      signSmartAccountActionDigestInternal: sign,
      sendAndSaveEthTransaction: send,
    } as any);
    controller.buildGuardianStartRecoveryOperation = jest.fn(
      async () => operation
    );
    controller.proveRecoveryTargetOwnership = jest.fn(async () => undefined);
    controller.validateSmartAccountGuardianRecoveryOperation = jest.fn(
      async () => undefined
    );
    controller.findLocalSigningAccount = jest.fn(() => ({
      id: 2,
      type: KeyringAccountType.HDAccount,
    }));
    controller.getSmartAccountGuardianRecoveryStatus = jest.fn(async () => ({
      recoveryTransactionHash: null,
    }));
    controller.getWalletGasPayerAccount = jest.fn(async () => ({
      id: 2,
      type: KeyringAccountType.HDAccount,
      address: GUARDIAN,
    }));
  });
  const mutate = (axis: string) => {
    if (axis === 'account') mockState.vault.activeAccount.id = 2;
    if (axis === 'RPC')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    if (axis === 'session') generation++;
  };
  it.each(['account', 'RPC', 'session'])(
    'refuses guardian signing after %s changes during preparation',
    async (axis) => {
      const gate = deferred<typeof operation>();
      controller.buildGuardianStartRecoveryOperation.mockReturnValue(
        gate.promise
      );
      const pending = prepare();
      const rejected = expect(pending).rejects.toThrow();
      mutate(axis);
      gate.resolve(operation);
      await rejected;
      expect(sign).not.toHaveBeenCalled();
    }
  );
  it.each(['submit', 'finalize'])(
    'refuses %s after selection changes during policy validation',
    async (stage) => {
      const gate = deferred<void>();
      controller.validateSmartAccountGuardianRecoveryOperation.mockReturnValue(
        gate.promise
      );
      const pending = stage === 'submit' ? submit() : finalize();
      const rejected = expect(pending).rejects.toThrow();
      mutate('account');
      gate.resolve();
      await rejected;
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('captures the reviewed operation, signature and preferred payer before asynchronous validation', async () => {
    const captured = { ...operation };
    const approval = { guardian: GUARDIAN, signature: '0x1234' };
    const payer = {
      id: 2,
      type: KeyringAccountType.HDAccount,
      address: GUARDIAN,
    };
    const gate = deferred<void>();
    controller.validateSmartAccountGuardianRecoveryOperation.mockReturnValue(
      gate.promise
    );
    const pending = controller.submitPreparedSmartAccountGuardianStartRecovery({
      claimHash: operation.hash,
      account: TARGET,
      guardian: GUARDIAN,
      approval,
      operation: captured,
      gasPayer: payer,
      expectedContext,
    });
    captured.salt = `0x${'55'.repeat(32)}`;
    captured.executionCalldata = '0x';
    approval.signature = '0xffff';
    payer.id = 99;
    gate.resolve();
    await pending;
    expect(controller.getWalletGasPayerAccount.mock.calls[0][1].id).toBe(2);
    const decoded = paliGuardianRecoveryModuleInterface.decodeFunctionData(
      'scheduleRecovery',
      send.mock.calls[0][0].data
    );
    expect(decoded[1]).toBe(operation.salt);
    expect(decoded[3]).toBe(operation.executionCalldata);
    expect(decoded[4][0].signature).toBe('0x1234');
  });
  it('retains a non-active local EOA guardian and the original execution payload', async () => {
    const prepared = await prepare();
    expect(prepared).toMatchObject({
      approval: { guardian: GUARDIAN, signature: '0x1234' },
    });
    expect(sign.mock.calls[0][1]).toEqual({
      id: 2,
      type: KeyringAccountType.HDAccount,
    });
    expect(sign.mock.calls[0][2]).toBe(prepared.executionContextId);
    expect(() =>
      controller.assertSmartAccountExecutionContext(
        prepared.executionContextId,
        operation.hash
      )
    ).not.toThrow();
    await expect(submit()).resolves.toMatchObject({
      transaction: { hash: HASH },
    });
    await expect(finalize()).resolves.toMatchObject({ hash: HASH });
  });

  it('binds a non-active smart guardian token to the wrapped recovery digest', async () => {
    controller.findLocalSigningAccount.mockReturnValue(null);
    controller.getHydratedActiveSmartAccount = jest.fn(async () => ({
      metadata: { isDeployed: true },
    }));
    const prepared = await prepare();
    const wrapped = getPaliErc7739PersonalSignHash({
      accountAddress: GUARDIAN,
      chainId: 57057,
      hash: operation.hash,
    });
    expect(() =>
      controller.assertSmartAccountExecutionContext(
        prepared.executionContextId,
        wrapped
      )
    ).not.toThrow();
    expect(() =>
      controller.assertSmartAccountExecutionContext(
        prepared.executionContextId,
        operation.hash
      )
    ).toThrow();
    mutate('session');
    expect(() =>
      controller.assertSmartAccountExecutionContext(
        prepared.executionContextId,
        wrapped
      )
    ).toThrow();
    expect(sign).not.toHaveBeenCalled();
  });

  it('does not allow a recovery signing token to authorize an ordinary UserOperation', async () => {
    const prepared = await prepare();
    await expect(
      controller.submitSmartAccountExecution({
        executionContextId: prepared.executionContextId,
        signature: '0x1234',
        userOperation: {},
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['account', 'RPC', 'session'])(
    'rejects %s changed between recovery prepare and submit',
    async (axis) => {
      const prepared = await prepare();
      mutate(axis);
      await expect(
        controller.submitPreparedSmartAccountGuardianStartRecovery({
          claimHash: operation.hash,
          ...prepared,
          expectedContext,
        })
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it.each(['submit', 'finalize'])(
    'retains the accepted %s result when the selection changes after publication',
    async (stage) => {
      send.mockImplementation(async () => {
        mutate('session');
        return { hash: HASH, wait: async () => undefined };
      });
      const result = stage === 'submit' ? await submit() : await finalize();
      expect(stage === 'submit' ? result.transaction.hash : result.hash).toBe(
        HASH
      );
      expect(send).toHaveBeenCalledTimes(1);
    }
  );
});
