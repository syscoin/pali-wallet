jest.mock('state/store', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getState: jest.fn() },
}));
jest.mock('state/vault', () => ({ setAccountPropertyByIdAndType: jest.fn() }));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  estimateSmartAccountUserOpGas: jest.fn(),
}));

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { Contract, Interface } from 'utils/ethersV6Compat';
import {
  encodeEcdsaValidatorInitData,
  estimateSmartAccountUserOpGas,
} from 'utils/smartAccount';

import SmartAccountController from './index';

const ADDRESS = `0x${'11'.repeat(20)}`;
const OWNER = `0x${'22'.repeat(20)}`;
const TARGET = `0x${'33'.repeat(20)}`;
const VALIDATOR = `0x${'44'.repeat(20)}`;
const HASH = `0x${'55'.repeat(32)}`;
const calls = [{ data: '0x', target: TARGET, value: '0x0' }];
const payer = { address: OWNER, id: 0, type: KeyringAccountType.HDAccount };
const metadata = {
  auth: {
    data: encodeEcdsaValidatorInitData([OWNER], 1),
    module: 'ecdsa',
    validator: VALIDATOR,
  },
  chainId: 1,
  deploymentSalt: `0x${'00'.repeat(32)}`,
  installedModules: [
    {
      address: VALIDATOR,
      config: { owners: [OWNER], threshold: 1 },
      id: 'ecdsa',
      type: 'validator',
    },
  ],
  isDeployed: true,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
};

describe('smart-account execution approval context', () => {
  let state: any;
  let generation: number;
  let transaction: any;
  let controller: any;
  let send: jest.Mock;
  let provider: any;
  const expectedContext = {
    account: { address: ADDRESS, id: 7, type: KeyringAccountType.SmartAccount },
    chainId: 1,
    rpcUrl: 'rpc-a',
    sessionGeneration: 9,
    slip44: 60,
  };
  const mutate = (axis: string) => {
    if (axis === 'account') state.vault.activeAccount.id = 8;
    if (axis === 'address')
      state.vault.accounts.SmartAccount[7].address = TARGET;
    if (axis === 'chain') state.vault.activeNetwork.chainId = 2;
    if (axis === 'RPC') state.vault.activeNetwork.url = 'rpc-b';
    if (axis === 'slip44') state.vaultGlobal.activeSlip44 = 57;
    if (axis === 'session') generation++;
    if (axis === 'provider') transaction.web3Provider = {};
    if (axis === 'transaction') transaction = { web3Provider: provider };
  };
  const prepare = () =>
    controller.prepareSmartAccountExecutions(calls, 7, { expectedContext });
  const submit = (prepared: any, changes: any = {}) =>
    controller.submitSmartAccountExecution({
      accountId: 7,
      executionContextId: prepared.executionContextId,
      executions: prepared.executions,
      expectedContext,
      gasPayer: payer,
      signature: '0x1234',
      userOperation: prepared.userOperation,
      ...changes,
    });

  beforeEach(() => {
    generation = 9;
    state = {
      vault: {
        accounts: {
          SmartAccount: {
            7: {
              address: ADDRESS,
              id: 7,
              isSmartAccount: true,
              smartAccount: metadata,
            },
            8: {
              address: TARGET,
              id: 8,
              isSmartAccount: true,
              smartAccount: metadata,
            },
          },
        },
        activeAccount: { id: 7, type: KeyringAccountType.SmartAccount },
        activeNetwork: {
          chainId: 1,
          kind: INetworkType.Ethereum,
          url: 'rpc-a',
        },
        isBitcoinBased: false,
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    (store.getState as jest.Mock).mockImplementation(() => state);
    (Contract as unknown as jest.Mock).mockImplementation((_address, abi) => ({
      getNonce: jest.fn().mockResolvedValue('0'),
      interface: Interface.from(abi),
    }));
    (estimateSmartAccountUserOpGas as jest.Mock).mockResolvedValue({
      callGasLimit: 100000,
      preVerificationGas: 50000,
      totalGasUnits: 300000,
      verificationGasLimit: 150000,
    });
    provider = {
      estimateGas: jest.fn().mockResolvedValue('200000'),
      getFeeData: jest.fn().mockResolvedValue({
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1,
      }),
    };
    transaction = { web3Provider: provider };
    send = jest.fn(async (_tx, _legacy, _payer, _meta, options) => {
      options.assertCurrentContext();
      return { hash: HASH };
    });
    controller = new SmartAccountController({
      getEthereumTransaction: () => transaction,
      getWalletSessionGeneration: () => generation,
      sendAndSaveEthTransaction: send,
    } as any);
    controller.assertSmartAccountExecutionTargetsAllowed = jest.fn();
    controller.getWalletGasPayerCandidates = jest.fn(() => []);
    controller.getWalletGasPayerAccount = jest.fn().mockResolvedValue(payer);
    controller.getLocalNativeExecutionRecipients = jest.fn(() => []);
  });

  it.each(['account', 'address', 'chain', 'RPC', 'slip44', 'session'])(
    'rejects an approval with stale %s before preparing',
    async (axis) => {
      mutate(axis);
      await expect(prepare()).rejects.toMatchObject({
        message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
        transactionNotBroadcast: true,
      });
      expect(
        controller.assertSmartAccountExecutionTargetsAllowed
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    'account',
    'address',
    'chain',
    'RPC',
    'slip44',
    'session',
    'provider',
    'transaction',
  ])(
    'rejects %s changing while preparation awaits its target checks',
    async (axis) => {
      const gate = deferred<void>();
      controller.assertSmartAccountExecutionTargetsAllowed.mockReturnValue(
        gate.promise
      );
      const preparing = prepare();
      const rejected = expect(preparing).rejects.toMatchObject({
        transactionNotBroadcast: true,
      });
      mutate(axis);
      gate.resolve();
      await rejected;
      expect(provider.getFeeData).not.toHaveBeenCalled();
    }
  );

  it('preserves the original approval session rather than refreshing it at preparation', async () => {
    generation += 2; // Account A -> B -> A, or lock/unlock with A restored.
    await expect(prepare()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
  });

  it('binds the background signing token to its exact locally derived digest', async () => {
    const prepared = await prepare();
    expect(() =>
      controller.assertSmartAccountExecutionContext(
        prepared.executionContextId,
        prepared.actionHash
      )
    ).not.toThrow();
    expect(() =>
      controller.assertSmartAccountExecutionContext(
        prepared.executionContextId,
        HASH
      )
    ).toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
  });

  it('expires a preparation without producing a reusable signing authority', async () => {
    const prepared = await prepare();
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1000);
    try {
      expect(() =>
        controller.assertSmartAccountExecutionContext(
          prepared.executionContextId,
          prepared.actionHash
        )
      ).toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects a changed UserOperation before exposing a signature to estimation', async () => {
    const prepared = await prepare();
    await expect(
      submit(prepared, {
        userOperation: { ...prepared.userOperation, callData: '0x1234' },
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(provider.estimateGas).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('requires the preparation token when submitting an external approval', async () => {
    const prepared = await prepare();
    await expect(
      submit(prepared, { executionContextId: undefined })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(provider.estimateGas).not.toHaveBeenCalled();
  });

  it('rejects an account switch while selecting the outer gas payer', async () => {
    const prepared = await prepare();
    const gate = deferred<any>();
    controller.getWalletGasPayerAccount.mockReturnValue(gate.promise);
    const submitting = submit(prepared);
    const rejected = expect(submitting).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    mutate('account');
    gate.resolve(payer);
    await rejected;
    expect(provider.estimateGas).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['account', 'RPC', 'session', 'provider'])(
    'does not submit after %s changes during outer estimation',
    async (axis) => {
      const prepared = await prepare();
      const gate = deferred<string>();
      provider.estimateGas.mockImplementationOnce(() => {
        mutate(axis);
        return gate.promise;
      });
      const submitting = submit(prepared);
      const rejected = expect(submitting).rejects.toMatchObject({
        transactionNotBroadcast: true,
      });
      gate.resolve('200000');
      await rejected;
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('submits an unchanged approval with an immutable outer sender and chain', async () => {
    const prepared = await prepare();
    await expect(submit(prepared)).resolves.toEqual({ hash: HASH });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1, from: OWNER }),
      false,
      { id: payer.id, type: payer.type },
      expect.objectContaining({ smartAccountExecutionFrom: ADDRESS }),
      expect.objectContaining({ assertCurrentContext: expect.any(Function) })
    );
  });
});
