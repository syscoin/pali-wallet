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
}));

import { getController } from '..';
import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';

import MainController from './MainController';

describe('infrastructure transaction broadcast boundary', () => {
  let wallet: any;
  let currentState: any;
  let send: jest.Mock;
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
    (getController as jest.Mock).mockReturnValue({
      wallet: {
        ethereumTransaction: {
          web3Provider: {},
          sendFormattedTransaction: send,
        },
      },
    });
    wallet = Object.create(MainController.prototype);
    wallet.getActiveKeyring = jest.fn(() => ({
      setVaultStateGetter: jest.fn(),
    }));
    wallet.sendAndSaveTransaction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

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

  it('leaves non-infrastructure preflight errors unchanged', async () => {
    const error = new Error('Preflight failed');
    (
      getBlacklistTargetsForEvmCallWithContractType as jest.Mock
    ).mockRejectedValueOnce(error);
    await expect(
      wallet.sendAndSaveEthTransaction({ chainId: 1 }, false, account)
    ).rejects.toBe(error);
    expect(send).not.toHaveBeenCalled();
    expect(error).not.toHaveProperty('transactionNotBroadcast');
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
    expect(assertCurrentContext).toHaveBeenCalledTimes(3);
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
      slip44: 60,
    };
    beforeEach(() => {
      currentState.vaultGlobal = { activeSlip44: 60 };
      wallet.walletSessionGeneration = 1;
    });

    it('rejects a context already changed before querying transaction targets', async () => {
      currentState.vault.activeNetwork.chainId = 2;
      await expect(
        wallet.sendAndSaveEthTransaction({}, false, undefined, undefined, {
          expectedContext,
        })
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
            { chainId: 1, from: 'payer-a' },
            false,
            undefined,
            undefined,
            { expectedContext }
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
      const params = { value: '0x1' };
      await wallet.sendAndSaveEthTransaction(
        params,
        false,
        undefined,
        undefined,
        { expectedContext }
      );
      expect(send).toHaveBeenCalledWith(
        { chainId: 1, from: 'payer-a', value: '0x1' },
        false
      );
      expect(params).toEqual({ value: '0x1' });
    });

    it.each([{ chainId: 2 }, { from: 'payer-b' }])(
      'rejects parameters outside the approved context: %j',
      async (params) => {
        await expect(
          wallet.sendAndSaveEthTransaction(
            params,
            false,
            undefined,
            undefined,
            { expectedContext }
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
          { chainId: 1 },
          false,
          undefined,
          undefined,
          { expectedContext }
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
