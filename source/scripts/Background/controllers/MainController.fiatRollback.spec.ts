import { configureStore } from '@reduxjs/toolkit';

import priceReducer from 'state/price';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';

import MainController from './MainController';

let mockStore: any;
let mockKeyring: any;
jest.mock('state/store', () => ({
  ...jest.requireActual('state/store'),
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
    getSlip44Vault: jest.fn(),
    setSlip44Vault: jest.fn().mockResolvedValue(undefined),
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
      price: { fiat: { asset: 'usd', price: 5 } },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  const actualStore = jest.requireActual('state/store').default;
  jest
    .spyOn(actualStore, 'getState')
    .mockImplementation(() => mockStore.getState());
  jest
    .spyOn(actualStore, 'dispatch')
    .mockImplementation((action: any) => mockStore.dispatch(action));
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

jest.mock('state/paliStorage', () => ({
  ...jest.requireActual('state/paliStorage'),
  loadPasskeyCredentialProfileState: jest.fn(),
}));

it.each([0, 1, 2, 3])(
  'does not strand a source quote after pre-transfer target validation rollback (microtasks=%s)',
  async (turns) => {
    const target = {
      kind: 'syscoin',
      chainId: 57,
      currency: 'SYS',
      slip44: 57,
      url: 'https://target.invalid',
    };
    const targetVault = {
      ...mockStore.getState().vault,
      activeNetwork: target,
      isBitcoinBased: true,
      accounts: {
        ...mockStore.getState().vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            address: 'sys1fixture',
            xpub: '',
            balances: { syscoin: 2 },
          },
        },
      },
    };
    const profile = deferred<any>();
    const { default: vaultCache } = jest.requireMock(
      'state/vaultCache'
    ) as typeof import('state/vaultCache');
    const { loadPasskeyCredentialProfileState } = jest.requireMock(
      'state/paliStorage'
    ) as typeof import('state/paliStorage');
    jest.mocked(vaultCache.getSlip44Vault).mockResolvedValue(targetVault);
    jest
      .mocked(loadPasskeyCredentialProfileState)
      .mockReturnValue(profile.promise);
    wallet.keyrings.set(57, {
      isUnlocked: () => false,
      setSignerNetwork: jest.fn(),
    });
    const json = deferred<any>();
    const pendingResponse = new Response('{}', { status: 200 });
    jest.spyOn(pendingResponse, 'json').mockReturnValue(json.promise);
    fetchPrice.mockResolvedValue(pendingResponse);
    const updating = wallet.setFiat('eur');
    await flush();
    const switching = wallet.setActiveNetwork(target);
    const outcome = switching.catch((error: any) => error);
    await flush();
    expect(loadPasskeyCredentialProfileState).toHaveBeenCalledWith(57);
    json.resolve({ [first.coingeckoId]: { eur: 4 } });
    for (let n = 0; n < turns; n++) await Promise.resolve();
    profile.resolve({});
    await updating;
    expect(await outcome).toMatchObject({
      message: expect.stringContaining('Account data is incomplete'),
    });
    await flush();
    expect(mockStore.getState().vault.activeNetwork).toEqual(first);
    expect(mockStore.getState().price.fiat.price).toBe(4);
    expect(mockStore.getState().vaultGlobal.networkStatus).toBe('error');
    expect(quote.mock.calls).toEqual([
      [1, 'eur'],
      [1, 'eur'],
    ]);
    expect(fetchPrice).toHaveBeenCalledTimes(1);
  }
);
