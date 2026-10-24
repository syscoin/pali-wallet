import { configureStore } from '@reduxjs/toolkit';

import priceReducer from 'state/price';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';

import MainController from './MainController';

let mockStore: any;
let mockKeyring: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
  persistCommittedWalletState: jest.fn().mockResolvedValue(undefined),
  saveMainState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Ledger: 'Ledger',
    Trezor: 'Trezor',
    SmartAccount: 'SmartAccount',
  },
  KeyringManager: jest.fn().mockImplementation(() => mockKeyring),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({
    dapp: {
      disconnect: jest.fn(),
      handleStateChange: jest.fn().mockResolvedValue(undefined),
    },
  }),
  notificationManager: { cleanup: jest.fn(), notifyNetworkChange: jest.fn() },
}));
jest.mock('state/vaultCache', () => ({
  ...jest.requireActual('state/vaultCache'),
  __esModule: true,
  default: {
    emergencySave: jest.fn().mockResolvedValue(undefined),
    clearCache: jest.fn(),
  },
}));
jest.mock('utils/slhDsa/offscreenClient', () => ({
  ...jest.requireActual('utils/slhDsa/offscreenClient'),
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
}));

const first = {
  kind: 'ethereum',
  chainId: 1,
  currency: 'ETH',
  slip44: 60,
  url: 'https://first.invalid',
  coingeckoId: 'first-coin',
};
const next = {
  ...first,
  chainId: 137,
  currency: 'POL',
  url: 'https://next.invalid',
  coingeckoId: 'next-coin',
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const response = (coin = first.coingeckoId, price = 4, currency = 'eur') =>
  ({
    ok: true,
    json: async () => ({ [coin]: { [currency]: price } }),
  } as Response);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
let wallet: any;
let quote: jest.SpyInstance;
let fetchPrice: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  fetchPrice = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network read'));
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      price: priceReducer,
      dapp: (state = { dapps: {} }) => state,
    },
    preloadedState: {
      vault: {
        ...vault,
        activeNetwork: first,
        isBitcoinBased: false,
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        accounts: {
          ...vault.accounts,
          HDAccount: {
            0: {
              id: 0,
              address: `0x${'11'.repeat(20)}`,
              xpub: 'fixture-public-key',
              balances: { ethereum: 2 },
            },
          },
        },
      } as any,
      vaultGlobal: {
        ...global,
        activeSlip44: 60,
        networks: { ...global.networks, ethereum: { 1: first, 137: next } },
      } as any,
      price: { fiat: { asset: 'usd', available: true, price: 5 } },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  mockKeyring = {
    setStorage: jest.fn(),
    setVaultStateGetter: jest.fn(),
    isUnlocked: jest.fn().mockReturnValue(true),
    setSignerNetwork: jest
      .fn()
      .mockRejectedValue(new Error('Synthetic RPC validation failed')),
    lockWallet: jest.fn().mockImplementation(async () => {
      mockKeyring.isUnlocked.mockReturnValue(false);
    }),
  };
  // Construct the controller: retain its actual arrow-field network logic,
  // signer switch, session invalidation and actual EVM quote reader/cache.
  wallet = new MainController();
  quote = jest.spyOn(wallet, 'getTokenPriceData');
  wallet.getLatestUpdateForCurrentAccount = jest
    .fn()
    .mockResolvedValue(undefined);
  wallet.saveWalletState = jest.fn().mockResolvedValue(undefined);
  wallet.isStartingUp = true;
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('keeps ordinary quote fetching unchanged', async () => {
  fetchPrice.mockResolvedValue(response());
  await wallet.setFiat('eur');
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'eur',
    available: true,
    price: 4,
  });
  expect(quote).toHaveBeenCalledTimes(1);
  expect(fetchPrice).toHaveBeenCalledTimes(1);
});

it('refreshes the retained context once after actual signer setup fails', async () => {
  fetchPrice.mockResolvedValue(response(first.coingeckoId, 5, 'usd'));
  await expect(wallet.setActiveNetwork(next)).rejects.toThrow(
    'Synthetic RPC validation failed'
  );
  await flush();
  expect(mockKeyring.setSignerNetwork).toHaveBeenCalledWith(
    expect.objectContaining(next)
  );
  expect(wallet.getWalletSessionGeneration()).toBe(1);
  expect(mockStore.getState().vault.activeNetwork).toEqual(first);
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('error');
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'usd',
    available: true,
    price: 5,
  });
  expect(quote).toHaveBeenCalledTimes(1);
  expect(fetchPrice).toHaveBeenCalledTimes(1);
});

it('retains an explicit currency quote through the real failed-switch signer epoch', async () => {
  const pending = deferred<Response>();
  fetchPrice.mockReturnValueOnce(pending.promise);
  const update = wallet.setFiat('eur');
  await flush();
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'eur',
    available: false,
    price: 0,
  });
  await expect(wallet.setActiveNetwork(next)).rejects.toThrow(
    'Synthetic RPC validation failed'
  );
  expect(wallet.getWalletSessionGeneration()).toBe(1);
  expect(mockStore.getState().vault.activeNetwork).toEqual(first);
  pending.resolve(response());
  await update;
  await flush();
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'eur',
    available: true,
    price: 4,
  });
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('error');
  expect(quote.mock.calls).toEqual([
    [1, 'eur'],
    [1, 'eur'],
  ]);
  expect(fetchPrice).toHaveBeenCalledTimes(1);
});

it('settles at zero on a genuine price-read failure without an error loop', async () => {
  const pending = deferred<Response>();
  fetchPrice.mockReturnValueOnce(pending.promise);
  const update = wallet.setFiat('eur');
  await flush();
  await expect(wallet.setActiveNetwork(next)).rejects.toThrow(
    'Synthetic RPC validation failed'
  );
  const invalidResponse = new Response('{}', { status: 200 });
  jest
    .spyOn(invalidResponse, 'json')
    .mockRejectedValue(new Error('Synthetic quote decode failure'));
  pending.resolve(invalidResponse);
  await update;
  await flush();
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'eur',
    available: false,
    price: 0,
  });
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('error');
  expect(quote).toHaveBeenCalledTimes(2);
  expect(fetchPrice).toHaveBeenCalledTimes(2);
  await flush();
  expect(quote).toHaveBeenCalledTimes(2);
});

it('uses only the normal success refresh after an actual successful signer switch', async () => {
  mockKeyring.setSignerNetwork.mockResolvedValue({ success: true });
  fetchPrice.mockResolvedValue(response(next.coingeckoId, 2, 'usd'));
  await wallet.setActiveNetwork(next);
  await flush();
  expect(mockStore.getState().vault.activeNetwork.chainId).toBe(137);
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'usd',
    available: true,
    price: 2,
  });
  expect(quote.mock.calls).toEqual([[137, 'usd']]);
});

it('does not enqueue failure recovery for a superseded signer switch', async () => {
  const signer = deferred<{ success: boolean }>();
  mockKeyring.setSignerNetwork
    .mockReturnValueOnce(signer.promise)
    .mockResolvedValue({ success: true });
  fetchPrice.mockResolvedValue(response(first.coingeckoId, 3, 'usd'));
  const stale = wallet.setActiveNetwork(next);
  const staleResult = stale.catch((error) => error);
  await flush();
  const latest = wallet.setActiveNetwork(first);
  signer.resolve({ success: true });
  expect(await staleResult).toBe('Network change cancelled');
  await latest;
  await flush();
  expect(quote.mock.calls).toEqual([[1, 'usd']]);
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'usd',
    available: true,
    price: 3,
  });
});

it('does not enqueue a refresh when an error-state subscriber locks the wallet', async () => {
  let unsubscribe: () => void = () => undefined;
  unsubscribe = mockStore.subscribe(() => {
    if (mockStore.getState().vaultGlobal.error) {
      unsubscribe();
      wallet.lock();
    }
  });
  await expect(wallet.setActiveNetwork(next)).rejects.toThrow(
    'Synthetic RPC validation failed'
  );
  await flush();
  expect(quote).not.toHaveBeenCalled();
  expect(fetchPrice).not.toHaveBeenCalled();
});

it('contains a failed recovery promise without replacing the original network error', async () => {
  const failure = new Error('Synthetic refresh failure');
  const refresh = jest.spyOn(wallet, 'setFiat').mockRejectedValueOnce(failure);
  await expect(wallet.setActiveNetwork(next)).rejects.toThrow(
    'Synthetic RPC validation failed'
  );
  await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith(
    '[MainController] Failed to refresh fiat:',
    failure
  );
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('error');
  expect(mockStore.getState().vaultGlobal.error).toBe(
    'Synthetic RPC validation failed'
  );
});

it.each(['lock', 'reset'] as const)(
  'retires pending quotes and queued currency changes on actual %s',
  async (operation) => {
    const pending = deferred<Response>();
    fetchPrice.mockReturnValueOnce(pending.promise);
    const update = wallet.setFiat('eur');
    await flush();
    const queuedCurrency = wallet.setFiat('gbp');
    await expect(wallet.setActiveNetwork(next)).rejects.toThrow(
      'Synthetic RPC validation failed'
    );
    let finishReset: Promise<void> | undefined;
    if (operation === 'lock') {
      wallet.lock();
    } else {
      // Enter the real reset, then stop at its timer-cleanup I/O boundary before
      // any storage deletion. Session/request invalidation has already run.
      wallet.stopAutoLockTimer = jest
        .fn()
        .mockRejectedValue(new Error('Controlled reset interruption'));
      finishReset = expect(wallet.resetWalletState()).rejects.toThrow(
        'Controlled reset interruption'
      );
    }
    pending.resolve(response());
    await update;
    await queuedCurrency;
    await finishReset;
    await flush();
    expect(quote).toHaveBeenCalledTimes(1);
    expect(mockStore.getState().price.fiat).toEqual({
      asset: 'eur',
      available: false,
      price: 0,
    });
  }
);
