jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({
      vault: {
        activeAccount: { id: 9, type: 'SmartAccount' },
        activeNetwork: {
          chainId: CHAIN_ID,
          kind: 'ethereum',
          url: 'https://fixture.invalid',
        },
      },
    }),
  },
}));

jest.mock('state/vault', () => ({
  setAccountPropertyByIdAndType: (payload: any) => ({
    payload,
    type: 'vault/setAccountPropertyByIdAndType',
  }),
}));

jest.mock('utils/security/blacklistService', () => ({
  blacklistService: {},
}));

import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { createTestEvmSubmissionCapture } from '../../../../../tests/helpers/evmSubmission';
import { KeyringAccountType } from 'types/network';
import { BigNumber } from 'utils/ethersV6Compat';
import {
  buildSmartAccountUserOperation,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
} from 'utils/smartAccount';
import { paliEntryPointInterface } from 'utils/smartAccount/contracts';
import { createSmartAccountPendingState } from 'utils/smartAccount/pendingState';

import SmartAccountController from './index';

const CHAIN_ID = 57;
const identity = smartAccountAddressFixture(CHAIN_ID);
const ACCOUNT_ADDRESS = identity.account.address;

const buildAccount = () => ({
  address: ACCOUNT_ADDRESS,
  smartAccount: { chainId: CHAIN_ID },
});

interface IDeferred {
  promise: Promise<any>;
  resolve: (value: any) => void;
}

const createDeferred = (): IDeferred => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('SmartAccountController metadata hydration cache', () => {
  let controller: any;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    controller = new SmartAccountController({} as any);
    fetchMock = jest.fn();
    controller.fetchSmartAccountMetadata = fetchMock;
  });

  it('deduplicates concurrent non-forced hydrations onto one fetch', async () => {
    const deferred = createDeferred();
    fetchMock.mockReturnValue(deferred.promise);

    const account = buildAccount();
    const first = controller.hydrateSmartAccountMetadata(account);
    const second = controller.hydrateSmartAccountMetadata(account);

    deferred.resolve({ isDeployed: true, marker: 'shared' });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult.marker).toBe('shared');
    expect(secondResult.marker).toBe('shared');

    // Completed result is served from cache without another fetch.
    const cachedResult = await controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedResult.marker).toBe('shared');
  });

  it('forceRefresh bypasses an in-flight hydration started before the change', async () => {
    const staleFetch = createDeferred();
    const freshFetch = createDeferred();
    fetchMock
      .mockReturnValueOnce(staleFetch.promise)
      .mockReturnValueOnce(freshFetch.promise);

    const account = buildAccount();
    // Pre-change hydration is still in flight when the forced refresh runs
    // (e.g. right after deployment confirmation).
    const stalePromise = controller.hydrateSmartAccountMetadata(account);
    const forcedPromise = controller.hydrateSmartAccountMetadata(account, {
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    freshFetch.resolve({ isDeployed: true, marker: 'fresh' });
    const forcedResult = await forcedPromise;
    expect(forcedResult.marker).toBe('fresh');

    // The superseded fetch resolving late must not clobber the fresh cache.
    staleFetch.resolve({ isDeployed: false, marker: 'stale' });
    await stalePromise;
    await flushMicrotasks();

    const cachedResult = await controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedResult.marker).toBe('fresh');
    expect(cachedResult.isDeployed).toBe(true);
  });

  it('invalidateHydratedMetadata detaches in-flight hydrations', async () => {
    const staleFetch = createDeferred();
    const freshFetch = createDeferred();
    fetchMock
      .mockReturnValueOnce(staleFetch.promise)
      .mockReturnValueOnce(freshFetch.promise);

    const account = buildAccount();
    const stalePromise = controller.hydrateSmartAccountMetadata(account);

    controller.invalidateHydratedMetadata(ACCOUNT_ADDRESS);

    // A non-forced call after invalidation must not join the detached fetch.
    const refreshedPromise = controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    staleFetch.resolve({ isDeployed: false, marker: 'stale' });
    await stalePromise;
    freshFetch.resolve({ isDeployed: true, marker: 'fresh' });
    const refreshedResult = await refreshedPromise;
    await flushMicrotasks();

    expect(refreshedResult.marker).toBe('fresh');
    const cachedResult = await controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedResult.marker).toBe('fresh');
  });
});

describe('SmartAccountController smart account execution fees', () => {
  const gasPayer = {
    address: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    id: 0,
    type: KeyringAccountType.HDAccount,
  };

  const buildController = () => {
    const estimateGas = jest.fn().mockResolvedValue('143280');
    const sendAndSaveEthTransaction = jest.fn().mockResolvedValue({
      hash: '0xabc',
      wait: jest.fn(),
    });
    const transaction = { web3Provider: { estimateGas } };
    const controller: any = new SmartAccountController({
      captureSmartAccountPendingRecords: async () => ({
        profileId: '0x' + '11'.repeat(32),
        read: async () => [],
      }),
      getEthereumTransaction: () => transaction,
      sendAndSaveEthTransaction,
    } as any);
    controller.getActiveSmartAccount = jest.fn(() => ({
      account: { ...identity.account, id: 9 },
      metadata: {
        chainId: CHAIN_ID,
        deploymentGasPayer: gasPayer,
      },
    }));
    controller.getSmartAccountById = jest.fn(() =>
      controller.getActiveSmartAccount()
    );
    controller.getWalletGasPayerAccount = jest.fn().mockResolvedValue(gasPayer);
    controller.getLocalNativeExecutionRecipients = jest.fn(() => []);
    controller.invalidateHydratedMetadata = jest.fn();

    return { controller, estimateGas, sendAndSaveEthTransaction };
  };

  const buildUserOperation = () =>
    buildSmartAccountUserOperation({
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
      sender: ACCOUNT_ADDRESS,
    });

  const withPreparedDeployment = (
    controller: any,
    userOperation: ReturnType<typeof buildUserOperation>,
    gasPrice?: string
  ) => {
    const executionContextId = 'reviewed-deployment';
    const provider = controller.ethereumTransaction.web3Provider;
    provider.verifyConfiguredChainId ??= jest.fn(async () => undefined);
    provider.send ??= jest.fn(async (method: string, params: any[]) => {
      if (method === 'eth_call')
        return paliEntryPointInterface.encodeFunctionResult('getNonce', [
          userOperation.nonce,
        ]);
      if (method === 'eth_getBalance') return '0x0';
      if (method === 'eth_getCode') return '0x01';
      if (method === 'eth_estimateGas')
        return (
          '0x' + BigInt(await provider.estimateGas(params[0])).toString(16)
        );
      throw new Error('Unexpected RPC ' + method);
    });
    const pending = createSmartAccountPendingState(
      provider,
      { profileId: '0x' + '11'.repeat(32), read: async () => [] },
      CHAIN_ID,
      ACCOUNT_ADDRESS,
      () => undefined
    );
    controller.executionContexts.set(executionContextId, {
      accountId: 9,
      expiresAt: Date.now() + 60_000,
      snapshot: controller.infrastructureContext(),
      gasPrice,
      userOperation: { ...userOperation },
      pending,
    });
    return { accountId: 9, executionContextId, userOperation };
  };

  // Unit fixtures supply the exact prepared operation context explicitly.
  const submitReviewed = (controller: any, params: any, guard?: () => void) =>
    controller.submitSmartAccountExecution(
      {
        accountId: 9,
        ...(params.executionContextId
          ? {}
          : withPreparedDeployment(
              controller,
              params.userOperation,
              params.gasPrice
            )),
        ...params,
      },
      guard
    );

  describe.each([
    ['native gas', 'insufficient funds', 'PALI_NATIVE_GAS_REQUIRED'],
    ['signature', 'AA24 signature error', 'PALI_SMART_ACCOUNT_SIGNATURE_ERROR'],
  ])('%s submission error normalization', (_kind, senderMessage, message) => {
    const submitRejected = async (error: unknown) => {
      const { controller, sendAndSaveEthTransaction } = buildController();
      sendAndSaveEthTransaction.mockRejectedValueOnce(error);
      return submitReviewed(controller, {
        executions: [],
        gasPayer,
        signature: '0x1234',
        userOperation: buildUserOperation(),
      });
    };

    it.each([true, false])(
      'preserves validated submission facts with transactionNotBroadcast=%s',
      async (transactionNotBroadcast) => {
        const transactionHash = `0x${'aB'.repeat(32)}`;
        const error = Object.freeze(
          Object.assign(new Error(senderMessage), {
            arbitraryPrivateData: 'must not be forwarded',
            transactionHash,
            transactionNotBroadcast,
          })
        );
        const normalized = await submitRejected(error).catch(
          (failure) => failure
        );

        expect(normalized).toBeInstanceOf(Error);
        expect(normalized.message).toBe(message);
        expect(Object.keys(normalized).sort()).toEqual([
          'transactionHash',
          'transactionNotBroadcast',
        ]);
        expect(normalized).toMatchObject({
          transactionHash,
          transactionNotBroadcast,
        });
        expect(error.message).toBe(senderMessage);
      }
    );

    it('preserves a valid hash independently of an invalid boolean', async () => {
      const transactionHash = `0x${'12'.repeat(32)}`;
      const normalized = await submitRejected({
        message: senderMessage,
        transactionHash,
        transactionNotBroadcast: 'true',
      }).catch((failure) => failure);

      expect(normalized.message).toBe(message);
      expect(Object.keys(normalized)).toEqual(['transactionHash']);
      expect(normalized.transactionHash).toBe(transactionHash);
    });

    it('drops invalid submission metadata and keeps the normalized ordinary error shape', async () => {
      const normalized = await submitRejected({
        message: senderMessage,
        transactionHash: `0x${'12'.repeat(31)}`,
        transactionNotBroadcast: 1,
      }).catch((failure) => failure);

      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe(message);
      expect(Object.keys(normalized)).toEqual([]);
    });
  });

  it('preserves an ordinary submission error without normalizing or cloning it', async () => {
    const { controller, sendAndSaveEthTransaction } = buildController();
    const error = Object.assign(new Error('RPC connection closed'), {
      transactionNotBroadcast: false,
    });
    sendAndSaveEthTransaction.mockRejectedValueOnce(error);

    await expect(
      submitReviewed(controller, {
        executions: [],
        gasPayer,
        signature: '0x1234',
        userOperation: buildUserOperation(),
      })
    ).rejects.toBe(error);
  });

  it('marks a removed preferred gas payer as prebroadcast before estimating or sending', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();
    controller.getWalletGasPayerAccount.mockRejectedValueOnce(
      new Error('Selected gas payer is no longer available')
    );
    await expect(
      submitReviewed(controller, {
        executions: [],
        gasPayer,
        signature: '0x1234',
        userOperation: buildUserOperation(),
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('marks a missing signed user operation as prebroadcast', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();
    await expect(
      controller.submitSmartAccountExecution({
        executions: [],
        gasPayer,
        signature: '0x1234',
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('marks an outer estimate failure before either sender as definitely not broadcast', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();
    const error = Object.freeze(new Error('execution reverted'));
    estimateGas.mockRejectedValueOnce(error);

    await expect(
      submitReviewed(controller, {
        executions: [],
        gasPayer,
        signature: '0x1234',
        userOperation: buildUserOperation(),
      })
    ).rejects.toMatchObject({
      message: 'execution reverted',
      transactionNotBroadcast: true,
    });
    expect(error).not.toHaveProperty('transactionNotBroadcast');
    expect(sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('still marks a failed estimate as prebroadcast when deployment prefunding made no send', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();
    controller.ensureSmartAccountDeploymentPrefund = jest
      .fn()
      .mockResolvedValue(undefined);
    estimateGas.mockRejectedValueOnce(new Error('execution reverted'));
    const userOperation = {
      ...buildUserOperation(),
      initCode: identity.deploymentInitCode,
    };

    await expect(
      submitReviewed(controller, {
        executions: [],
        gasPayer,
        signature: '0x1234',
        ...withPreparedDeployment(controller, userOperation),
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(controller.ensureSmartAccountDeploymentPrefund).toHaveBeenCalled();
    expect(sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('never funds a first UserOperation with altered deployment bytes', async () => {
    const { controller, sendAndSaveEthTransaction } = buildController();
    const prefund = jest.spyOn(
      controller,
      'ensureSmartAccountDeploymentPrefund'
    );
    await expect(
      submitReviewed(controller, {
        executions: [],
        gasPayer,
        signature: '0x1234',
        ...withPreparedDeployment(controller, {
          ...buildUserOperation(),
          initCode: '0x1234',
        }),
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(prefund).not.toHaveBeenCalled();
    expect(sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('never funds a canonical first UserOperation without its prepared owner context', async () => {
    const { controller, sendAndSaveEthTransaction } = buildController();
    const prefund = jest.spyOn(
      controller,
      'ensureSmartAccountDeploymentPrefund'
    );
    await expect(
      controller.submitSmartAccountExecution({
        executions: [],
        gasPayer,
        signature: '0x1234',
        userOperation: {
          ...buildUserOperation(),
          initCode: identity.deploymentInitCode,
        },
      })
    ).rejects.toMatchObject({
      message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
      transactionNotBroadcast: true,
    });
    expect(prefund).not.toHaveBeenCalled();
    expect(sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'does not relabel a failure after a prefund sender was entered (prefund returned=%s)',
    async (prefundReturned) => {
      const { controller, estimateGas, sendAndSaveEthTransaction } =
        buildController();
      const error = new Error('RPC timed out');
      controller.ensureSmartAccountDeploymentPrefund = jest.fn(
        async (...args: any[]) => {
          args[5].onSubmissionAttempt();
          if (!prefundReturned) throw error;
        }
      );
      estimateGas.mockRejectedValueOnce(error);

      await expect(
        submitReviewed(controller, {
          executions: [],
          gasPayer,
          signature: '0x1234',
          ...withPreparedDeployment(controller, {
            ...buildUserOperation(),
            initCode: identity.deploymentInitCode,
          }),
        })
      ).rejects.toBe(error);
      expect(error).not.toHaveProperty('transactionNotBroadcast');
      expect(sendAndSaveEthTransaction).not.toHaveBeenCalled();
    }
  );

  it('does not relabel an unclassified outer sender failure as prebroadcast', async () => {
    const { controller, sendAndSaveEthTransaction } = buildController();
    const error = new Error('RPC timed out');
    sendAndSaveEthTransaction.mockRejectedValueOnce(error);

    await expect(
      submitReviewed(controller, {
        executions: [],
        gasPayer,
        signature: '0x1234',
        userOperation: buildUserOperation(),
      })
    ).rejects.toBe(error);
    expect(error).not.toHaveProperty('transactionNotBroadcast');
  });

  it('does not add EIP-1559 outer fees when legacy preparation has no priority fee', async () => {
    const { controller, sendAndSaveEthTransaction } = buildController();

    await submitReviewed(controller, {
      executions: [],
      gasPayer,
      maxFeePerGas: '1000000000',
      signature: '0x1234',
      userOperation: buildUserOperation(),
    });

    expect(sendAndSaveEthTransaction).toHaveBeenCalledWith(
      expect.not.objectContaining({
        maxFeePerGas: expect.anything(),
        maxPriorityFeePerGas: expect.anything(),
      }),
      false,
      { id: gasPayer.id, type: gasPayer.type },
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('preserves explicit zero priority fee overrides for the outer transaction', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();

    await submitReviewed(controller, {
      executions: [],
      gasPayer,
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '0',
      signature: '0x1234',
      userOperation: buildUserOperation(),
    });

    expect(sendAndSaveEthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        gasLimit: '143280',
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '0',
      }),
      false,
      { id: gasPayer.id, type: gasPayer.type },
      expect.any(Object),
      expect.any(Object)
    );
    expect(estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        from: gasPayer.address,
      })
    );
    expect(estimateGas).toHaveBeenCalledWith(
      expect.not.objectContaining({
        maxFeePerGas: expect.anything(),
        maxPriorityFeePerGas: expect.anything(),
      })
    );
  });

  it('reuses the gas-tank credit estimate for the outer transaction', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();
    controller.getActiveSmartAccount.mockReturnValue({
      account: { address: ACCOUNT_ADDRESS, id: 9 },
      metadata: {
        chainId: 57057,
        deploymentGasPayer: gasPayer,
      },
    });
    controller.assertZkSysGasTankCoversTransaction = jest
      .fn()
      .mockResolvedValue(BigNumber.from('143280'));
    const userOperation = buildUserOperation();
    userOperation.gasFees = encodeSmartAccountGasFees({
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
    });

    await submitReviewed(controller, {
      executions: [],
      gasPayer,
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '0',
      signature: '0x1234',
      userOperation,
    });

    expect(
      controller.assertZkSysGasTankCoversTransaction
    ).toHaveBeenCalledTimes(1);
    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendAndSaveEthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ gasLimit: '143280' }),
      false,
      { id: gasPayer.id, type: gasPayer.type },
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('checks tank credit at the exact legacy price and reuses that outer estimate', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();
    controller.getActiveSmartAccount.mockReturnValue({
      account: { address: ACCOUNT_ADDRESS, id: 9 },
      metadata: { chainId: 57057, deploymentGasPayer: gasPayer },
    });
    controller.assertZkSysGasTankCoversTransaction = jest
      .fn()
      .mockResolvedValue(BigNumber.from('143280'));
    const userOperation = buildUserOperation();
    userOperation.gasFees = encodeSmartAccountGasFees({
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
    });
    await submitReviewed(controller, {
      executions: [],
      gasPayer,
      gasPrice: '13',
      signature: '0x1234',
      userOperation,
    });
    expect(controller.assertZkSysGasTankCoversTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ gasPrice: '13', maxFeePerGas: '13' }),
      expect.anything()
    );
    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendAndSaveEthTransaction.mock.calls[0][0]).toMatchObject({
      gasPrice: '13',
      gasLimit: '143280',
    });
    expect(sendAndSaveEthTransaction.mock.calls[0][1]).toBe(true);
  });

  it.each([
    ['prefund', 'before POST'],
    ['handleOps', 'before POST'],
    ['prefund', 'after ACK'],
    ['handleOps', 'during ACK'],
    ['prefund', 'wait failure'],
    ['handleOps', 'wait failure'],
  ] as const)(
    'checks the real SDK %s guard %s without misclassifying a wire dispatch',
    async (operation, phase) => {
      const key = `0x${'11'.repeat(32)}`;
      const owner = new Wallet(key);
      const fixturePayer = { ...gasPayer, address: owner.address };
      const document = new AbortController();
      const entered = createDeferred();
      const resume = createDeferred();
      const check = () => {
        if (document.signal.aborted)
          throw Object.assign(new Error('Approval document changed'), {
            transactionNotBroadcast: true,
          });
      };
      const { controller, estimateGas, sendAndSaveEthTransaction } =
        buildController();
      const provider = {
        estimateGas,
        getBalance: jest.fn().mockResolvedValue(BigNumber.from(0)),
        call: jest.fn().mockResolvedValue(`0x${'0'.repeat(64)}`),
        verifyConfiguredChainId: jest.fn().mockResolvedValue(undefined),
        getTransactionCount: jest.fn().mockResolvedValue(7),
        getFeeData: jest.fn().mockResolvedValue({
          gasPrice: BigNumber.from(13),
          maxFeePerGas: BigNumber.from(13),
          maxPriorityFeePerGas: BigNumber.from(1),
        }),
        sendTransaction: jest.fn(async (raw: string) => {
          const hash = Transaction.from(raw).hash;
          if (phase === 'during ACK') {
            entered.resolve(undefined);
            await resume.promise;
          }
          return {
            hash,
            async wait() {
              if (phase === 'after ACK' || phase === 'wait failure') {
                entered.resolve(undefined);
                await resume.promise;
              }
              if (phase === 'wait failure')
                throw Object.assign(
                  new Error('Transaction confirmation failed'),
                  {
                    transactionHash: `0x${'ff'.repeat(32)}`,
                    transactionNotBroadcast: true,
                  }
                );
            },
          };
        }),
      };
      const transaction = { web3Provider: provider };
      controller.deps.getEthereumTransaction = () => transaction;
      controller.getWalletGasPayerAccount.mockResolvedValue(fixturePayer);
      const persistSigned = jest.fn(async () => {
        if (phase === 'before POST') {
          entered.resolve(undefined);
          await resume.promise;
        }
      });
      const signingNetwork = {
        kind: 'ethereum',
        chainId: CHAIN_ID,
        slip44: 60,
        url: 'https://test-only.invalid',
      } as const;
      const sdk = new EthereumTransactions(
        () => signingNetwork as any,
        () => ({ address: owner.address, decryptedPrivateKey: key }),
        () =>
          ({
            activeAccountId: 0,
            activeAccountType: KeyringAccountType.HDAccount,
            accounts: {
              [KeyringAccountType.HDAccount]: { 0: { address: owner.address } },
            },
            activeNetwork: {
              kind: 'ethereum',
              chainId: CHAIN_ID,
              slip44: 60,
              url: 'https://test-only.invalid',
            },
          } as any),
        {} as any,
        {} as any,
        () => () => undefined,
        () => ({
          assertCurrent: () => undefined,
          persistSigned,
          dispatchSigned: async (_record, initiate, preflight) => {
            await preflight();
            return initiate();
          },
        })
      );
      Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
      sendAndSaveEthTransaction.mockImplementation(
        async (transaction, legacy, _payer, _metadata, options) => {
          // The production MainController invokes the independent popup guard
          // before signing, and only its wallet context after the wire ACK.
          const response = await sdk.sendFormattedTransaction(
            transaction,
            legacy,
            {
              assertCurrent() {
                options.assertCurrentContext();
                options.assertBeforeSign?.();
              },
              mode: 'specialized',
              selectedAccount: {
                id: 0,
                type: 'HDAccount',
                expectedAddress: owner.address,
              },
              targetAccount: {
                id: 0,
                type: 'HDAccount',
                expectedAddress: owner.address,
              },
            }
          );
          await options.onBroadcast?.(response);
          options.assertCurrentContext();
          return response;
        }
      );
      const userOperation = {
        ...buildUserOperation(),
        ...(operation === 'prefund'
          ? { initCode: identity.deploymentInitCode }
          : {}),
      };
      const approval = submitReviewed(
        controller,
        {
          executions: [],
          gasPayer: fixturePayer,
          gasPrice: '13',
          signature: '0x1234',
          ...(operation === 'prefund'
            ? withPreparedDeployment(controller, userOperation, '13')
            : { userOperation }),
          waitForConfirmation:
            operation === 'handleOps' && phase === 'wait failure',
        },
        check
      );
      const result = approval.catch((error: unknown) => error);
      const stage = await Promise.race([
        entered.promise.then(() => 'entered'),
        result.then((error) => {
          throw error;
        }),
      ]);
      expect(stage).toBe('entered');
      document.abort();
      resume.resolve(undefined);
      const outcome = await result;
      expect(persistSigned).toHaveBeenCalledTimes(1);
      expect(sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
      expect(sendAndSaveEthTransaction.mock.calls[0]?.[3]).toMatchObject(
        operation === 'prefund'
          ? { smartAccountDeploymentPrefund: true }
          : { smartAccountExecution: true }
      );
      if (phase === 'before POST') {
        expect(provider.sendTransaction).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ transactionNotBroadcast: true });
      } else {
        expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
        const [raw] = provider.sendTransaction.mock.calls[0]!;
        const { hash } = Transaction.from(raw);
        if (operation === 'prefund') {
          expect(outcome).toMatchObject({ transactionNotBroadcast: false });
          expect(outcome).not.toHaveProperty('transactionHash');
          expect(estimateGas).toHaveBeenCalledTimes(1);
        } else if (phase === 'wait failure') {
          expect(outcome).toBeInstanceOf(Error);
          expect(outcome).toMatchObject({
            message: 'Transaction confirmation failed',
            transactionHash: hash,
            transactionNotBroadcast: false,
          });
        } else expect(outcome).toMatchObject({ hash });
      }
    }
  );

  it.each(['0', '13'])(
    'published SDK signs type-0 at exact gasPrice=%s without fetching a higher recommendation',
    async (gasPrice) => {
      // Synthetic public fixture only. The published signer is real; all RPC
      // edges are local mocks and signed bytes never leave this test.
      const fixtureKey = `0x${'11'.repeat(32)}`;
      const owner = new Wallet(fixtureKey);
      const fixturePayer = {
        address: owner.address,
        id: 0,
        type: KeyringAccountType.HDAccount,
      };
      let signedBytes = '';
      const provider = {
        verifyConfiguredChainId: jest.fn().mockResolvedValue(undefined),
        getTransactionCount: jest.fn().mockResolvedValue(7),
        getNetwork: jest.fn().mockResolvedValue({ chainId: CHAIN_ID }),
        getGasPrice: jest.fn().mockResolvedValue(BigNumber.from('999999999')),
        getFeeData: jest
          .fn()
          .mockResolvedValue({ gasPrice: BigNumber.from('999999999') }),
        sendTransaction: jest.fn(async (raw: string) => {
          signedBytes = raw;
          return { hash: Transaction.from(raw).hash, wait: jest.fn() };
        }),
      };
      const sdk = new EthereumTransactions(
        () => ({ chainId: CHAIN_ID } as any),
        () => ({ address: owner.address, decryptedPrivateKey: fixtureKey }),
        () =>
          ({
            activeAccountId: 0,
            activeAccountType: KeyringAccountType.HDAccount,
            accounts: {
              [KeyringAccountType.HDAccount]: { 0: { address: owner.address } },
            },
            activeNetwork: { chainId: CHAIN_ID },
          } as any),
        {} as any,
        {} as any,
        () => () => undefined,
        createTestEvmSubmissionCapture()
      );
      Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
      const { controller, sendAndSaveEthTransaction } = buildController();
      controller.getWalletGasPayerAccount.mockResolvedValue(fixturePayer);
      sendAndSaveEthTransaction.mockImplementation(
        (transaction, legacy, _account, _metadata, approval) =>
          sdk.sendFormattedTransaction(transaction, legacy, {
            assertCurrent: approval.assertCurrentContext,
            mode: 'specialized',
            selectedAccount: {
              id: 0,
              type: 'HDAccount',
              expectedAddress: owner.address,
            },
            targetAccount: {
              id: 0,
              type: 'HDAccount',
              expectedAddress: owner.address,
            },
          })
      );
      await submitReviewed(controller, {
        executions: [],
        gasPayer: fixturePayer,
        gasPrice,
        signature: '0x1234',
        userOperation: buildUserOperation(),
      });
      const signed = Transaction.from(signedBytes);
      expect(signed.type).toBe(0);
      expect(signed.gasPrice).toBe(BigInt(gasPrice));
      expect(signed.from).toBe(owner.address);
      expect(signed.chainId).toBe(BigInt(CHAIN_ID));
      expect(provider.getGasPrice).not.toHaveBeenCalled();
      expect(provider.getFeeData).not.toHaveBeenCalled();
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    }
  );
});
