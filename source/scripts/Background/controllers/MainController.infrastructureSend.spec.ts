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
    expect(assertCurrentContext).toHaveBeenCalledTimes(2);
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
    });
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });
});
