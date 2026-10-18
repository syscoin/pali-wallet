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
  toPaliSmartAccount: jest.fn(
    jest.requireActual('utils/smartAccount').toPaliSmartAccount
  ),
}));

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { BigNumber, Contract, Interface } from 'utils/ethersV6Compat';
import {
  buildSmartAccountUserOperation,
  encodeEcdsaValidatorInitData,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
  estimateSmartAccountUserOpGas,
  toPaliSmartAccount,
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
      gasPrice: prepared.gasPrice,
      signature: '0x1234',
      userOperation: prepared.userOperation,
      ...changes,
    });

  beforeEach(() => {
    jest
      .mocked(toPaliSmartAccount)
      .mockImplementation(
        jest.requireActual('utils/smartAccount').toPaliSmartAccount
      );
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

  it.each(['account', 'RPC', 'session'])(
    'does not persist hydrated metadata after %s changes during the read',
    async (axis) => {
      const gate = deferred<any>();
      controller.getSmartAccountById = jest.fn(() => ({
        account: state.vault.accounts.SmartAccount[7],
        metadata,
      }));
      controller.hydrateSmartAccountMetadata = jest.fn(() => gate.promise);
      controller.persistSmartAccountMetadata = jest.fn();
      const operation = controller.hydrateSmartAccount(7, expectedContext);
      const rejected = expect(operation).rejects.toThrow();
      mutate(axis);
      gate.resolve(metadata);
      await rejected;
      expect(controller.persistSmartAccountMetadata).not.toHaveBeenCalled();
    }
  );

  describe('registration admission before execution preparation', () => {
    const registration = () => {
      jest
        .mocked(toPaliSmartAccount)
        .mockResolvedValue({ address: ADDRESS } as any);
      jest.mocked(store.dispatch).mockClear();
      const gate = deferred<string>();
      provider.getCode = jest.fn(() => gate.promise);
      const registeredMetadata = {
        ...metadata,
        descriptor: { deploymentSalt: `0x${'00'.repeat(32)}` },
      };
      controller.getSmartAccountById = jest.fn(() => ({
        account: state.vault.accounts.SmartAccount[7],
        metadata: registeredMetadata,
      }));
      controller.prepareSmartAccountExecutions = jest.fn(async () => ({
        actionHash: HASH,
        executions: calls,
        executionContextId: 'registration-fixture',
      }));
      controller.signActionHashWithLocalEcdsaOwners = jest.fn(
        async () => '0x1234'
      );
      controller.submitSmartAccountExecution = jest.fn(async () => ({
        hash: HASH,
      }));
      controller.hydrateSmartAccountMetadata = jest.fn(
        async () => registeredMetadata
      );
      controller.deps.saveWalletState = jest.fn();
      return gate;
    };

    it.each(['account', 'RPC', 'session'])(
      'does not sign registration after %s changes during the code read',
      async (axis) => {
        const gate = registration();
        const operation = controller.registerSmartAccountOnChain({
          accountId: 7,
          expectedContext,
        });
        const rejected = expect(operation).rejects.toMatchObject({
          transactionNotBroadcast: true,
        });
        mutate(axis);
        gate.resolve('0x');
        await rejected;
        expect(controller.prepareSmartAccountExecutions).not.toHaveBeenCalled();
        expect(
          controller.signActionHashWithLocalEcdsaOwners
        ).not.toHaveBeenCalled();
        expect(store.dispatch).not.toHaveBeenCalled();
      }
    );

    it('registers the unchanged context and propagates its original approval', async () => {
      const gate = registration();
      const operation = controller.registerSmartAccountOnChain({
        accountId: 7,
        expectedContext,
      });
      gate.resolve('0x');
      await expect(operation).resolves.toMatchObject({
        transaction: { hash: HASH },
      });
      expect(controller.prepareSmartAccountExecutions).toHaveBeenCalledWith(
        expect.any(Array),
        7,
        { expectedContext }
      );
      expect(controller.submitSmartAccountExecution).toHaveBeenCalledWith(
        expect.objectContaining({ expectedContext })
      );
      expect(store.dispatch).toHaveBeenCalledTimes(1);
    });

    it('classifies a genuine failed code read as unsent without mutating or forwarding arbitrary RPC fields', async () => {
      registration();
      const failure = Object.freeze(
        Object.assign(new Error('Code read unavailable'), {
          code: -32002,
          data: { privateProviderDetail: true },
          transactionNotBroadcast: false,
          transactionHash: HASH,
        })
      );
      provider.getCode.mockRejectedValueOnce(failure).mockResolvedValue('0x');
      const error = await controller
        .registerSmartAccountOnChain({ accountId: 7, expectedContext })
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBe(failure);
      expect(error).toMatchObject({
        message: 'Code read unavailable',
        code: -32002,
        transactionNotBroadcast: true,
      });
      expect(error).not.toHaveProperty('data');
      expect(error).not.toHaveProperty('transactionHash');
      expect(failure.transactionNotBroadcast).toBe(false);
      expect(controller.prepareSmartAccountExecutions).not.toHaveBeenCalled();
      expect(controller.submitSmartAccountExecution).not.toHaveBeenCalled();
      await expect(
        controller.registerSmartAccountOnChain({
          accountId: 7,
          expectedContext,
        })
      ).resolves.toMatchObject({ transaction: { hash: HASH } });
      expect(controller.getSmartAccountById).toHaveBeenCalledWith(7);
      expect(controller.submitSmartAccountExecution).toHaveBeenCalledTimes(1);
    });

    it('classifies an unavailable provider before registration as definitely unsent', async () => {
      registration();
      transaction.web3Provider = undefined;
      await expect(
        controller.registerSmartAccountOnChain({
          accountId: 7,
          expectedContext,
        })
      ).rejects.toMatchObject({
        message: 'Web3 provider not available',
        transactionNotBroadcast: true,
      });
      expect(controller.submitSmartAccountExecution).not.toHaveBeenCalled();
    });

    it.each(['prepare', 'sign'])(
      'classifies a failed %s before submit and releases only its unsent reservation',
      async (stage) => {
        registration();
        provider.getCode.mockResolvedValue('0x');
        const method =
          stage === 'prepare'
            ? controller.prepareSmartAccountExecutions
            : controller.signActionHashWithLocalEcdsaOwners;
        method.mockRejectedValueOnce(
          Object.freeze(new Error('Preflight unavailable'))
        );
        await expect(
          controller.registerSmartAccountOnChain({
            accountId: 7,
            expectedContext,
          })
        ).rejects.toMatchObject({
          message: 'Preflight unavailable',
          transactionNotBroadcast: true,
        });
        expect(controller.submitSmartAccountExecution).not.toHaveBeenCalled();
        expect(controller.pendingDeploymentAddresses.has(ADDRESS)).toBe(false);
        await expect(
          controller.registerSmartAccountOnChain({
            accountId: 7,
            expectedContext,
          })
        ).resolves.toMatchObject({ transaction: { hash: HASH } });
        expect(controller.submitSmartAccountExecution).toHaveBeenCalledTimes(1);
      }
    );

    it.each(['hydration', 'persistence'])(
      'classifies an already-deployed %s failure as unsent when no submit was entered',
      async (stage) => {
        registration();
        provider.getCode.mockResolvedValue('0x6000');
        (stage === 'hydration'
          ? controller.hydrateSmartAccountMetadata
          : controller.deps.saveWalletState
        ).mockRejectedValueOnce(new Error('Refresh unavailable'));
        await expect(
          controller.registerSmartAccountOnChain({
            accountId: 7,
            expectedContext,
          })
        ).rejects.toMatchObject({
          message: 'Refresh unavailable',
          transactionNotBroadcast: true,
        });
        expect(controller.submitSmartAccountExecution).not.toHaveBeenCalled();
      }
    );

    it.each([undefined, false, true, 'hash'])(
      'preserves the exact downstream submission error and its outcome (%s)',
      async (outcome) => {
        registration();
        provider.getCode.mockResolvedValue('0x');
        const failure = Object.freeze(
          Object.assign(
            new Error('Submission result'),
            outcome === 'hash'
              ? { transactionHash: HASH }
              : outcome === undefined
              ? {}
              : { transactionNotBroadcast: outcome }
          )
        );
        controller.submitSmartAccountExecution.mockRejectedValueOnce(failure);
        await expect(
          controller.registerSmartAccountOnChain({
            accountId: 7,
            expectedContext,
          })
        ).rejects.toBe(failure);
        expect(controller.pendingDeploymentAddresses.has(ADDRESS)).toBe(false);
        expect(controller.hydrateSmartAccountMetadata).not.toHaveBeenCalled();
      }
    );

    it('does not classify a pre-existing pending registration as safely unsent or remove its reservation', async () => {
      registration();
      controller.pendingDeploymentAddresses.add(ADDRESS);
      const error = await controller
        .registerSmartAccountOnChain({ accountId: 7, expectedContext })
        .catch((reason: unknown) => reason);
      expect(error.message).toBe(
        'Smart account registration is already pending.'
      );
      expect(error).not.toHaveProperty('transactionNotBroadcast');
      expect(controller.pendingDeploymentAddresses.has(ADDRESS)).toBe(true);
      expect(provider.getCode).not.toHaveBeenCalled();
      expect(controller.submitSmartAccountExecution).not.toHaveBeenCalled();
    });

    it.each(['account', 'RPC', 'session'])(
      'preserves registration ACK but skips stale %s metadata',
      async (axis) => {
        const code = registration();
        const entered = deferred<void>();
        const acknowledged = deferred<{ hash: string }>();
        controller.submitSmartAccountExecution.mockImplementation(async () => {
          entered.resolve();
          return acknowledged.promise;
        });
        const operation = controller.registerSmartAccountOnChain({
          accountId: 7,
          expectedContext,
        });
        code.resolve('0x');
        await entered.promise;
        mutate(axis);
        acknowledged.resolve({ hash: HASH });
        await expect(operation).resolves.toMatchObject({
          transaction: { hash: HASH },
        });
        expect(controller.hydrateSmartAccountMetadata).not.toHaveBeenCalled();
        expect(store.dispatch).not.toHaveBeenCalled();
      }
    );

    it.each(['hydration', 'persistence'])(
      'does not erase a registration ACK on %s failure',
      async (stage) => {
        const gate = registration();
        (stage === 'hydration'
          ? controller.hydrateSmartAccountMetadata
          : controller.deps.saveWalletState
        ).mockRejectedValue(new Error('local refresh failed'));
        const operation = controller.registerSmartAccountOnChain({
          accountId: 7,
          expectedContext,
        });
        gate.resolve('0x');
        await expect(operation).resolves.toMatchObject({
          transaction: { hash: HASH },
        });
      }
    );
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

  it.each([false, true])(
    'marks the real prefund sender boundary only when a topup is needed (already funded=%s)',
    async (alreadyFunded) => {
      const onSubmissionAttempt = jest.fn();
      const wait = jest.fn().mockResolvedValue(undefined);
      provider.getBalance = jest
        .fn()
        .mockResolvedValue(BigNumber.from(alreadyFunded ? 2 : 0));
      (Contract as unknown as jest.Mock).mockImplementation(() => ({
        balanceOf: jest.fn().mockResolvedValue(0),
      }));
      send.mockImplementation(async () => {
        expect(onSubmissionAttempt).toHaveBeenCalledTimes(1);
        return { hash: HASH, wait };
      });
      const userOperation = buildSmartAccountUserOperation({
        accountGasLimits: encodeSmartAccountGasLimits({
          callGasLimit: 1,
          verificationGasLimit: 1,
        }),
        callData: '0x',
        gasFees: encodeSmartAccountGasFees({
          maxFeePerGas: 1,
          maxPriorityFeePerGas: 0,
        }),
        nonce: '0',
        preVerificationGas: '0',
        sender: ADDRESS,
      });
      await controller.ensureSmartAccountDeploymentPrefund(
        ADDRESS,
        userOperation,
        TARGET,
        payer,
        1,
        undefined,
        onSubmissionAttempt
      );
      expect(onSubmissionAttempt).toHaveBeenCalledTimes(alreadyFunded ? 0 : 1);
      expect(send).toHaveBeenCalledTimes(alreadyFunded ? 0 : 1);
      expect(wait).toHaveBeenCalledTimes(alreadyFunded ? 0 : 1);
    }
  );

  it('preserves an explicit legacy price below a higher provider recommendation through the UserOp and outer send', async () => {
    const prepared = await controller.prepareSmartAccountExecutions(calls, 7, {
      expectedContext,
      feeOverrides: { gasPrice: '13' },
    });
    expect(prepared).toMatchObject({
      gasPrice: '13',
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    });
    expect(prepared.userOperation.gasFees).toBe(
      encodeSmartAccountGasFees({
        maxFeePerGas: '13',
        maxPriorityFeePerGas: '13',
      })
    );
    await expect(submit(prepared)).resolves.toEqual({ hash: HASH });
    expect(provider.estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({ gasPrice: '13', from: OWNER })
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ gasPrice: '13', gasLimit: '200000' }),
      true,
      { id: payer.id, type: payer.type },
      expect.any(Object),
      expect.any(Object)
    );
    expect(send.mock.calls[0][0]).not.toHaveProperty('maxFeePerGas');
    expect(send.mock.calls[0][0]).not.toHaveProperty('maxPriorityFeePerGas');
  });

  it('keeps an explicit zero legacy price instead of treating it as an absent override', async () => {
    provider.getFeeData.mockResolvedValue({
      gasPrice: 1000,
      lastBaseFeePerGas: 0,
      maxFeePerGas: 2000,
      maxPriorityFeePerGas: 1,
    });
    const prepared = await controller.prepareSmartAccountExecutions(calls, 7, {
      expectedContext,
      feeOverrides: { gasPrice: '0' },
    });
    expect(prepared.gasPrice).toBe('0');
    expect(prepared.userOperation.gasFees).toBe(
      encodeSmartAccountGasFees({
        maxFeePerGas: '0',
        maxPriorityFeePerGas: '0',
      })
    );
    await submit(prepared);
    expect(send.mock.calls[0][0].gasPrice).toBe('0');
    expect(send.mock.calls[0][1]).toBe(true);
  });

  it('rejects an explicit legacy price below a known protocol base fee without substituting the recommendation', async () => {
    provider.getFeeData.mockResolvedValue({
      gasPrice: 1000,
      lastBaseFeePerGas: 20,
    });
    await expect(
      controller.prepareSmartAccountExecutions(calls, 7, {
        expectedContext,
        feeOverrides: { gasPrice: '13' },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('current base fee'),
      transactionNotBroadcast: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { gasPrice: '13', maxFeePerGas: '13' },
    { gasPrice: '13', maxPriorityFeePerGas: '0' },
    { gasPrice: '-1' },
    { gasPrice: 'not-a-price' },
    { gasPrice: (BigInt(1) << BigInt(128)).toString() },
  ])(
    'rejects an invalid or mixed legacy override before preparing: %j',
    async (feeOverrides) => {
      await expect(
        controller.prepareSmartAccountExecutions(calls, 7, {
          expectedContext,
          feeOverrides,
        })
      ).rejects.toMatchObject({ transactionNotBroadcast: true });
      expect(
        controller.assertSmartAccountExecutionTargetsAllowed
      ).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('freezes the explicit override before asynchronous preparation reads', async () => {
    const gate = deferred<void>();
    controller.assertSmartAccountExecutionTargetsAllowed.mockReturnValue(
      gate.promise
    );
    const feeOverrides = { gasPrice: '13' };
    const preparing = controller.prepareSmartAccountExecutions(calls, 7, {
      expectedContext,
      feeOverrides,
    });
    feeOverrides.gasPrice = '99';
    gate.resolve();
    expect((await preparing).gasPrice).toBe('13');
  });

  it.each([undefined, '14'])(
    'rejects a changed or missing prepared legacy price before estimation: %s',
    async (gasPrice) => {
      const prepared = await controller.prepareSmartAccountExecutions(
        calls,
        7,
        { expectedContext, feeOverrides: { gasPrice: '13' } }
      );
      await expect(submit(prepared, { gasPrice })).rejects.toMatchObject({
        transactionNotBroadcast: true,
      });
      expect(provider.estimateGas).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('cannot replace an EIP-1559 preparation with a legacy outer send', async () => {
    const prepared = await prepare();
    await expect(submit(prepared, { gasPrice: '13' })).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    expect(provider.estimateGas).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
