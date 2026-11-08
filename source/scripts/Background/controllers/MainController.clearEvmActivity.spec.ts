jest.mock('..', () => ({
  getController: () => ({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  }),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import vaultReducer from 'state/vault';
import vaultCache from 'state/vaultCache';
import { getWalletNavigationScope } from 'utils/navigationState';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const address = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const profileId = '0x' + '11'.repeat(32);
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve!: (value: number) => void;
  const promise = new Promise<number>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('explicit EVM activity and nonce reset', () => {
  let wallet: any;
  let state: any;
  let keyring: any;
  let records: any;
  let writes: jest.SpyInstance;
  const clear = () =>
    wallet.clearEvmActivityAndNonce(
      getWalletNavigationScope(),
      'clear-activity-and-nonce-data'
    );
  const history = (type = 'HDAccount', id = 0, chain = 1) =>
    state.vault.accountTransactions[type][id].ethereum[chain];

  beforeEach(() => {
    vaultCache.clearCache();
    walletPersistenceGate.blocked = false;
    const initial = vaultReducer(undefined, { type: '@@init' });
    const account = {
      ...initial.accounts.HDAccount[0],
      id: 0,
      address,
      label: 'Test account',
      evmTxCountByChainId: { 1: 4, 2: 5 },
    };
    const rows = () => ({
      ethereum: {
        1: [{ hash: 'pending', nonce: 0 }],
        2: [{ hash: 'other-chain' }],
      },
      syscoin: { 57: [{ txid: 'utxo' }] },
    });
    state = {
      ...store.getState(),
      vault: {
        ...initial,
        isBitcoinBased: false,
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: {
          kind: 'ethereum',
          chainId: 1,
          slip44: 60,
          url: 'https://rpc.invalid',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: { 0: account, 1: { ...account, id: 1, address: other } },
          Imported: {
            0: {
              ...account,
              address: address.toUpperCase().replace('0X', '0x'),
            },
          },
        },
        accountTransactions: {
          HDAccount: { 0: rows(), 1: rows() },
          Imported: { 0: rows() },
        },
      },
      vaultGlobal: {
        ...store.getState().vaultGlobal,
        activeSlip44: 60,
        networkStatus: 'idle',
        isSwitchingAccount: false,
      },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
      state = { ...state, vault: vaultReducer(state.vault, action) };
      return action;
    });
    writes = jest.spyOn(chromeStorage, 'setItems').mockResolvedValue(undefined);
    keyring = {
      isUnlocked: () => true,
      getPrivateRecordProfileId: jest.fn().mockResolvedValue(profileId),
    };
    records = {
      captureSession: jest.fn((session) => session),
      clearScope: jest.fn().mockResolvedValue(2),
    };
    wallet = Object.create(MainController.prototype);
    Object.assign(wallet, {
      walletSessionGeneration: 0,
      networkRequestGeneration: 0,
      transactionUpdateRequestId: 0,
      getActiveKeyring: () => keyring,
      isUnlocked: () => true,
      retainedEvmRecords: records,
      activeRapidPolls: new Map(),
      pendingEvmReceiptChecks: new Map(),
      cancellablePromises: { transactionPromise: { cancel: jest.fn() } },
      transactionsManager: { utils: { clearCache: jest.fn() } },
      clearWalletSaveTimeout: jest.fn(),
      stopAllRapidPolling: jest.fn(),
      lock: jest.fn(),
    });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    vaultCache.clearCache();
    walletPersistenceGate.blocked = false;
  });

  it('clears aliases only on the selected chain after the durable journal reset', async () => {
    const beforeNetwork = state.vault.activeNetwork;
    const beforeAccounts = clone(state.vault.accounts);
    expect(await clear()).toBe(2);
    expect(records.clearScope).toHaveBeenCalledWith(
      expect.objectContaining({ keyring }),
      { profileId, chainId: '1', from: address }
    );
    expect(history()).toBeUndefined();
    expect(history('Imported')).toBeUndefined();
    expect(history('HDAccount', 1)).toEqual([{ hash: 'pending', nonce: 0 }]);
    expect(history('HDAccount', 0, 2)).toEqual([{ hash: 'other-chain' }]);
    expect(state.vault.accountTransactions.HDAccount[0].syscoin[57]).toEqual([
      { txid: 'utxo' },
    ]);
    expect(state.vault.accounts.HDAccount[0].evmTxCountByChainId).toEqual({
      2: 5,
    });
    expect(state.vault.accounts.HDAccount[1]).toEqual(
      beforeAccounts.HDAccount[1]
    );
    expect(state.vault.activeNetwork).toBe(beforeNetwork);
    expect(wallet.getActiveKeyring()).toBe(keyring);
    expect(writes).toHaveBeenCalled();
    expect(wallet.lock).not.toHaveBeenCalled();
  });

  it('revokes old sessions and blocks new signing before the first asynchronous read', async () => {
    const pending = deferred();
    keyring.getPrivateRecordProfileId.mockReturnValue(pending.promise);
    const result = clear();
    expect(wallet.walletSessionGeneration).toBe(1);
    expect(wallet.networkRequestGeneration).toBe(1);
    expect(
      wallet.cancellablePromises.transactionPromise.cancel
    ).toHaveBeenCalledTimes(1);
    expect(wallet.transactionsManager.utils.clearCache).toHaveBeenCalledTimes(
      1
    );
    expect(() => wallet.assertWalletReadyForSigning()).toThrow();
    expect(records.clearScope).not.toHaveBeenCalled();
    pending.resolve(profileId as any);
    await result;
    expect(() => wallet.assertWalletReadyForSigning()).not.toThrow();
  });

  it('requires the current scope and explicit confirmation before changing anything', async () => {
    await expect(
      wallet.clearEvmActivityAndNonce(getWalletNavigationScope(), 'yes')
    ).rejects.toThrow();
    await expect(
      wallet.clearEvmActivityAndNonce(
        { account: 'stale', network: 'stale' },
        'clear-activity-and-nonce-data'
      )
    ).rejects.toThrow();
    state = { ...state, vault: { ...state.vault, isBitcoinBased: true } };
    await expect(clear()).rejects.toThrow();
    expect(wallet.walletSessionGeneration).toBe(0);
    expect(records.clearScope).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('locks and rejects when public history cannot be committed after the private reset', async () => {
    writes.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(clear()).rejects.toThrow('storage unavailable');
    expect(records.clearScope).toHaveBeenCalledTimes(1);
    expect(history()).toEqual([{ hash: 'pending', nonce: 0 }]);
    expect(wallet.lock).toHaveBeenCalledTimes(1);
  });

  it('does not clear another account if the active context changes during profile access', async () => {
    const pending = deferred();
    keyring.getPrivateRecordProfileId.mockReturnValue(pending.promise);
    const result = clear();
    state = {
      ...state,
      vault: { ...state.vault, activeAccount: { type: 'HDAccount', id: 1 } },
    };
    pending.resolve(profileId as any);
    await expect(result).rejects.toThrow();
    expect(records.clearScope).not.toHaveBeenCalled();
    expect(history('HDAccount', 1)).toEqual([{ hash: 'pending', nonce: 0 }]);
  });
  it('discards a receipt result that started before the reset', async () => {
    jest.useFakeTimers();
    const lookup = deferred();
    wallet.getEvmTransactionFromProvider = jest.fn(() => lookup.promise);
    wallet.updateTrackedEvmTransactionCopies = jest.fn();
    wallet.startRapidTransactionPolling('0x' + 'ab'.repeat(32), 1, false);
    jest.advanceTimersByTime(4000);
    expect(wallet.getEvmTransactionFromProvider).toHaveBeenCalledTimes(1);
    await clear();
    lookup.resolve({ hash: '0x' + 'ab'.repeat(32), blockNumber: 10 } as any);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(wallet.updateTrackedEvmTransactionCopies).not.toHaveBeenCalled();
  });
});
