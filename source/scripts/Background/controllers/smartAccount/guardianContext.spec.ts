jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));

import { INetworkType, KeyringAccountType } from 'types/network';
import {
  getConfiguredAuthenticatorAddress,
  ERC7579_MODE_SINGLE_DEFAULT,
  getPaliErc7739PersonalSignHash,
} from 'utils/smartAccount';

import SmartAccountController from './index';

let mockState: any;
const TARGET = `0x${'11'.repeat(20)}`;
const ACTIVE = `0x${'22'.repeat(20)}`;
const GUARDIAN = `0x${'33'.repeat(20)}`;
const HASH = `0x${'44'.repeat(32)}`;
const operation = {
  account: TARGET,
  chainId: 57057,
  executionCalldata: '0x1234',
  mode: ERC7579_MODE_SINGLE_DEFAULT,
  policyEpoch: '1',
  recoveryModule: getConfiguredAuthenticatorAddress(57057, 'guardian-recovery'),
  salt: `0x${'00'.repeat(32)}`,
  hash: HASH,
};
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
  const prepare = () =>
    controller.prepareSmartAccountGuardianStartRecovery({
      account: TARGET,
      guardian: GUARDIAN,
      target: {},
      expectedContext,
    });
  const submit = () =>
    controller.submitPreparedSmartAccountGuardianStartRecovery({
      account: TARGET,
      guardian: GUARDIAN,
      approval: { guardian: GUARDIAN, signature: '0x1234' },
      operation,
      expectedContext,
    });
  const finalize = () =>
    controller.finalizeSmartAccountGuardianRecovery({
      ...operation,
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
      getEthereumTransaction: () => transaction,
      getWalletSessionGeneration: () => generation,
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
        HASH
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
      hash: HASH,
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
        HASH
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
