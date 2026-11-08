jest.mock('..', () => ({ getController: jest.fn() }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('./storageManager', () => ({
  StorageManager: {
    getInstance: () => ({ ensureInitialized: async () => undefined }),
  },
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest
    .fn()
    .mockResolvedValue([]),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
  clearTransactionNavigationState: jest.fn().mockResolvedValue(undefined),
  getWalletNavigationScope: jest.fn(() => ({
    account: 'account-a',
    network: 'network-a',
  })),
}));

import { getController } from '..';
import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { BigNumber } from 'utils/ethersV6Compat';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';

import MainController from './MainController';

describe('infrastructure transaction broadcast boundary', () => {
  let wallet: any;
  let currentState: any;
  let send: jest.Mock;
  const internalApproval = { assertCurrentContext: () => undefined };
  const specialized = expect.objectContaining({
    mode: 'specialized',
    assertCurrent: expect.any(Function),
  });
  const account = { id: 0, type: KeyringAccountType.HDAccount };
  const response = {
    hash: `0x${'12'.repeat(32)}`,
    nonce: 7,
    chainId: 1,
    wait: jest.fn(),
  };
  const metadata = {
    smartAccountInfrastructureDeployment: true,
    smartAccountInfrastructureId: 'factory',
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation();
    (getBlacklistTargetsForEvmCallWithContractType as jest.Mock)
      .mockReset()
      .mockResolvedValue([]);
    currentState = {
      vault: {
        activeNetwork: {
          chainId: 1,
          kind: INetworkType.Ethereum,
          url: 'rpc-a',
        },
        activeAccount: account,
        accounts: { HDAccount: { 0: { id: 0, address: 'payer-a' } } },
      },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => currentState);
    send = jest.fn().mockResolvedValue(response);
    const ethereumTransaction = {
      web3Provider: {},
      sendFormattedTransaction: send,
    };
    (getController as jest.Mock).mockReturnValue({
      wallet: { ethereumTransaction },
    });
    wallet = Object.create(MainController.prototype);
    wallet.getActiveKeyring = jest.fn(() => ({
      setVaultStateGetter: jest.fn(),
      ethereumTransaction,
    }));
    wallet.sendAndSaveTransaction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, { expectedContext: { sessionGeneration: 1 } }])(
    'refuses the old generic path without trusted approval before any RPC: %j',
    async (approval) => {
      await expect(
        wallet.sendAndSaveEthTransaction(
          { value: '0x1' },
          false,
          undefined,
          undefined,
          approval
        )
      ).rejects.toMatchObject({
        message: 'Explicit transaction approval is required',
        transactionNotBroadcast: true,
      });
      expect(
        getBlacklistTargetsForEvmCallWithContractType
      ).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('does not let a software account choose the hardware approval lane', async () => {
    wallet.assertAssetMutationContext = jest.fn();
    await expect(
      wallet.sendAndSaveEthTransaction(
        { value: '0x1' },
        false,
        undefined,
        undefined,
        { hardwareScope: { account: 'a', network: 'b' } }
      )
    ).rejects.toMatchObject({
      message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
      transactionNotBroadcast: true,
    });
    expect(wallet.assertAssetMutationContext).toHaveBeenCalledTimes(1);
    expect(
      getBlacklistTargetsForEvmCallWithContractType
    ).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [KeyringAccountType.Ledger, undefined, 7, 'automatic'],
    [KeyringAccountType.Trezor, 0, 0, 'manual'],
  ])(
    'binds the selected native nonce before invoking %s',
    async (type, nonce, expected, source) => {
      const address = `0x${'11'.repeat(20)}`;
      currentState.vault.activeAccount = { id: 0, type };
      currentState.vault.accounts[type] = { 0: { id: 0, address } };
      wallet.assertAssetMutationContext = jest.fn();
      wallet.captureFreshEvmRead = jest.fn(() => ({
        network: currentState.vault.activeNetwork,
      }));
      wallet.inspectOrdinaryEvmNonce = jest.fn(async () => ({
        nonce: expected,
      }));
      const transaction = {
        from: address,
        to: `0x${'22'.repeat(20)}`,
        chainId: 1,
        data: '0x',
        value: '0x1',
        gasPrice: '0x1',
        gasLimit: '0x5208',
        ...(nonce === undefined ? {} : { nonce }),
      };
      await expect(
        wallet.sendAndSaveEthTransaction(
          transaction,
          true,
          undefined,
          undefined,
          { hardwareScope: { account: 'a', network: 'b' } }
        )
      ).resolves.toBe(response);
      expect(wallet.inspectOrdinaryEvmNonce).toHaveBeenCalledWith(
        expect.any(Object),
        address,
        expect.objectContaining({
          reviewed: nonce === undefined ? undefined : { nonce, source },
        })
      );
      expect(send).toHaveBeenCalledWith(
        { ...transaction, nonce: expected },
        true,
        expect.objectContaining({ walletNonce: { nonce: expected, source } })
      );
    }
  );

  it.each([{ maxFeePerGas: '0x0', maxPriorityFeePerGas: '0x0' }])(
    'blocks zero EIP-1559 maximum fees before SDK submission: %p',
    async (fees) => {
      await expect(
        wallet.sendAndSaveEthTransaction(
          { type: '0x2', ...fees },
          false,
          undefined,
          undefined,
          internalApproval
        )
      ).rejects.toMatchObject({ code: 4200 });
      expect(send).not.toHaveBeenCalled();
      expect(
        getBlacklistTargetsForEvmCallWithContractType
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ type: '0x0', gasPrice: '0x0' }, true],
    [{ type: '0x2', maxFeePerGas: '0x10', maxPriorityFeePerGas: '0x1' }, false],
    [{ type: '0x2', maxFeePerGas: '0x10', maxPriorityFeePerGas: '0x0' }, false],
  ])(
    'passes supported fees unchanged to the SDK: %p',
    async (params, legacy) => {
      await wallet.sendAndSaveEthTransaction(
        params,
        legacy,
        undefined,
        undefined,
        internalApproval
      );
      expect(send).toHaveBeenCalledWith(params, legacy, specialized);
    }
  );

  it.each([0, 10000000000])(
    'validates serialized popup priority fees before SDK submission: %s',
    async (priority) => {
      const params = JSON.parse(
        JSON.stringify({
          type: '0x2',
          maxFeePerGas: BigNumber.from('50000000000'),
          maxPriorityFeePerGas: BigNumber.from(priority),
        })
      );
      await wallet.sendAndSaveEthTransaction(
        params,
        false,
        undefined,
        undefined,
        internalApproval
      );
      expect(send).toHaveBeenCalledWith(params, false, specialized);
    }
  );
  it.each([null, '-1', '', { hex: 'broken' }, '0x11'])(
    'rejects malformed or above-cap priority %p before blacklist/keyring work',
    async (priority) => {
      await expect(
        wallet.sendAndSaveEthTransaction(
          { type: '0x2', maxFeePerGas: '0x10', maxPriorityFeePerGas: priority },
          false,
          undefined,
          undefined,
          internalApproval
        )
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect(
        getBlacklistTargetsForEvmCallWithContractType
      ).not.toHaveBeenCalled();
    }
  );

  it.each(['blacklist discovery', 'context validation', 'keyring preparation'])(
    'marks a %s failure as definitely before submission',
    async (stage) => {
      const error = new Error(`Arbitrary ${stage} failure`);
      const assertCurrentContext = jest.fn();
      if (stage === 'blacklist discovery') {
        (
          getBlacklistTargetsForEvmCallWithContractType as jest.Mock
        ).mockRejectedValueOnce(error);
      } else if (stage === 'context validation') {
        assertCurrentContext.mockImplementationOnce(() => {
          throw error;
        });
      } else {
        wallet.getActiveKeyring.mockImplementationOnce(() => {
          throw error;
        });
      }

      await expect(
        wallet.sendAndSaveEthTransaction(
          { chainId: 1, nonce: 7 },
          false,
          account,
          metadata,
          { assertCurrentContext }
        )
      ).rejects.toMatchObject({
        message: error.message,
        transactionNotBroadcast: true,
      });
      expect(send).not.toHaveBeenCalled();
      expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
    }
  );

  it('preserves ambiguous failures after entering the sender without a pre-broadcast marker', async () => {
    const error = Object.assign(
      new Error('Transport failed after submission'),
      {
        code: 'NETWORK_ERROR',
      }
    );
    send.mockRejectedValueOnce(error);
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1, nonce: 7 },
        false,
        account,
        metadata,
        { assertCurrentContext: jest.fn() }
      )
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveProperty('transactionNotBroadcast');
  });

  it('marks a specialized preflight failure as definitely not broadcast', async () => {
    const error = new Error('Preflight failed');
    (
      getBlacklistTargetsForEvmCallWithContractType as jest.Mock
    ).mockRejectedValueOnce(error);
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1 },
        false,
        account,
        undefined,
        internalApproval
      )
    ).rejects.toMatchObject({
      message: error.message,
      transactionNotBroadcast: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('journals the original hash and refuses to file it in a different network after broadcast', async () => {
    let finishBroadcast!: (value: any) => void;
    let started!: () => void;
    const broadcastStarted = new Promise<void>(
      (resolve) => (started = resolve)
    );
    send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBroadcast = resolve;
          started();
        })
    );
    const durablePending: any[] = [];
    const onBroadcast = jest.fn(async (tx) => {
      durablePending.push({ chainId: 1, hash: tx.hash });
    });
    const assertCurrentContext = jest.fn(() => {
      if (currentState.vault.activeNetwork.chainId !== 1)
        throw new Error('Wallet context changed');
    });
    const sending = wallet.sendAndSaveEthTransaction(
      { chainId: 1, nonce: 7, data: '0x1234' },
      false,
      account,
      metadata,
      { onBroadcast, assertCurrentContext }
    );
    const rejected = expect(sending).rejects.toMatchObject({
      message: 'Wallet context changed',
      transactionHash: response.hash,
    });
    await broadcastStarted;
    currentState.vault = {
      ...currentState.vault,
      activeNetwork: { chainId: 2, kind: INetworkType.Ethereum, url: 'rpc-b' },
      accounts: { HDAccount: { 0: { id: 0, address: 'payer-b' } } },
    };
    finishBroadcast(response);
    await rejected;
    expect(durablePending).toEqual([{ chainId: 1, hash: response.hash }]);
    expect(onBroadcast).toHaveBeenCalledTimes(1);
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('completes the durable broadcast callback before saving transaction history', async () => {
    let releaseJournal!: () => void;
    let started!: () => void;
    const journalStarted = new Promise<void>((resolve) => (started = resolve));
    const onBroadcast = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseJournal = resolve;
          started();
        })
    );
    const assertCurrentContext = jest.fn();
    const sending = wallet.sendAndSaveEthTransaction(
      { chainId: 1, nonce: 7 },
      false,
      account,
      metadata,
      { onBroadcast, assertCurrentContext }
    );
    await journalStarted;
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
    releaseJournal();
    await expect(sending).resolves.toMatchObject({ ...response, ...metadata });
    expect(assertCurrentContext).toHaveBeenCalledTimes(4);
    expect(wallet.sendAndSaveTransaction).toHaveBeenCalledTimes(1);
  });

  it('preserves the broadcast hash when journal persistence fails', async () => {
    const onBroadcast = jest
      .fn()
      .mockRejectedValue(new Error('Storage unavailable'));
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1, nonce: 7 },
        false,
        account,
        metadata,
        { onBroadcast, assertCurrentContext: jest.fn() }
      )
    ).rejects.toMatchObject({
      message: 'Storage unavailable',
      transactionHash: response.hash,
      transactionNonce: response.nonce,
    });
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  describe('approved EOA context', () => {
    const expectedContext = {
      account: { ...account, address: 'payer-a' },
      chainId: 1,
      rpcUrl: 'rpc-a',
      sessionGeneration: 1,
      slip44: 60,
    };
    beforeEach(() => {
      currentState.vaultGlobal = { activeSlip44: 60 };
      wallet.walletSessionGeneration = 1;
      wallet.captureFreshEvmRead = jest.fn(() => ({
        network: currentState.vault.activeNetwork,
      }));
      wallet.inspectOrdinaryEvmNonce = jest.fn(
        async (_read, _from, options) => {
          options.assertCurrent();
          return { nonce: 7 };
        }
      );
    });

    it('reports an acknowledged dapp hash to the worker before history persistence fails', async () => {
      const events: string[] = [];
      wallet.sendAndSaveTransaction.mockImplementation(async () => {
        events.push('history');
        throw new Error('Synthetic history persistence failure');
      });
      const onBroadcast = jest.fn(async (ack) => {
        expect(ack.hash).toBe(response.hash);
        expect(ack.nonce).toBe(7);
        events.push('ack');
      });
      const transaction = {
        chainId: 1,
        from: 'payer-a',
        nonce: 7,
        gasPrice: '0x1',
        value: '0x1',
      };
      await expect(
        wallet.sendAndSaveEthTransaction(
          transaction,
          true,
          undefined,
          undefined,
          {
            expectedContext,
            authorizeDapp: () => undefined,
            dappNonceApproval: { nonce: 7, source: 'automatic' },
            onBroadcast,
          }
        )
      ).rejects.toMatchObject({
        message: 'Synthetic history persistence failure',
        transactionHash: response.hash,
        transactionNonce: 7,
        transactionNotBroadcast: false,
      });
      expect(send).toHaveBeenCalledWith(
        transaction,
        true,
        expect.objectContaining({
          walletNonce: { nonce: 7, source: 'automatic' },
        })
      );
      expect(onBroadcast).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['ack', 'history']);
    });

    it('rejects a context already changed before querying transaction targets', async () => {
      currentState.vault.activeNetwork.chainId = 2;
      await expect(
        wallet.sendAndSaveEthTransaction(
          { nonce: 7 },
          false,
          undefined,
          undefined,
          {
            expectedContext,
            authorizeDapp: () => undefined,
            dappNonceApproval: { nonce: 7, source: 'automatic' },
          }
        )
      ).rejects.toMatchObject({
        message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
        transactionNotBroadcast: true,
      });
      expect(
        getBlacklistTargetsForEvmCallWithContractType
      ).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it.each(['network', 'account', 'rpc', 'slip44', 'session', 'reset'])(
      'rejects a %s change during async preflight before the sender captures state',
      async (change) => {
        (
          getBlacklistTargetsForEvmCallWithContractType as jest.Mock
        ).mockImplementationOnce(async () => {
          if (change === 'network')
            currentState.vault.activeNetwork.chainId = 2;
          if (change === 'account')
            currentState.vault.activeAccount = { ...account, id: 1 };
          if (change === 'rpc') currentState.vault.activeNetwork.url = 'rpc-b';
          if (change === 'slip44') currentState.vaultGlobal.activeSlip44 = 57;
          if (change === 'session') wallet.walletSessionGeneration += 1;
          if (change === 'reset') wallet.isResettingWallet = true;
          return [];
        });
        await expect(
          wallet.sendAndSaveEthTransaction(
            { chainId: 1, from: 'payer-a', nonce: 7 },
            false,
            undefined,
            undefined,
            {
              expectedContext,
              authorizeDapp: () => undefined,
              dappNonceApproval: { nonce: 7, source: 'automatic' },
            }
          )
        ).rejects.toMatchObject({
          message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
          transactionNotBroadcast: true,
        });
        expect(send).not.toHaveBeenCalled();
        expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
      }
    );

    it('sets the approved chain and sender without mutating the caller transaction', async () => {
      const params = { value: '0x1', nonce: 7 };
      await wallet.sendAndSaveEthTransaction(
        params,
        false,
        undefined,
        undefined,
        {
          expectedContext,
          authorizeDapp: () => undefined,
          dappNonceApproval: { nonce: 7, source: 'automatic' },
        }
      );
      expect(send).toHaveBeenCalledWith(
        { chainId: 1, from: 'payer-a', value: '0x1', nonce: 7 },
        false,
        expect.objectContaining({
          mode: 'specialized',
          assertCurrent: expect.any(Function),
          walletNonce: { nonce: 7, source: 'automatic' },
        })
      );
      expect(params).toEqual({ value: '0x1', nonce: 7 });
    });

    it.each([{ chainId: 2 }, { from: 'payer-b' }])(
      'rejects parameters outside the approved context: %j',
      async (params) => {
        await expect(
          wallet.sendAndSaveEthTransaction(
            { ...params, nonce: 7 },
            false,
            undefined,
            undefined,
            {
              expectedContext,
              authorizeDapp: () => undefined,
              dappNonceApproval: { nonce: 7, source: 'automatic' },
            }
          )
        ).rejects.toMatchObject({ transactionNotBroadcast: true });
        expect(send).not.toHaveBeenCalled();
      }
    );

    it('keeps an acknowledged hash and avoids current-network history after a switch during broadcast', async () => {
      send.mockImplementationOnce(async () => {
        currentState.vault.activeNetwork.chainId = 2;
        return response;
      });
      await expect(
        wallet.sendAndSaveEthTransaction(
          { chainId: 1, nonce: 7 },
          false,
          undefined,
          undefined,
          {
            expectedContext,
            authorizeDapp: () => undefined,
            dappNonceApproval: { nonce: 7, source: 'automatic' },
          }
        )
      ).rejects.toMatchObject({
        message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
        transactionHash: response.hash,
        transactionNotBroadcast: false,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
    });
  });
});
