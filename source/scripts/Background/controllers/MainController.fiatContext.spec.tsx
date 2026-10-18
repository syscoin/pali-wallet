import { configureStore } from '@reduxjs/toolkit';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';

import { FiatComponent } from 'components/FiatComponent/FiatComponent';
import { usePageLoadingState } from 'hooks/usePageLoadingState';
import { Home } from 'pages/Home/Home';
import priceReducer from 'state/price';
import vaultReducer, { setAccountBalanceForNetwork } from 'state/vault';
import vaultGlobalReducer, {
  setNetwork,
  startSwitchNetwork,
} from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';

import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';

let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
  persistCommittedWalletState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Ledger: 'Ledger',
    Trezor: 'Trezor',
    SmartAccount: 'SmartAccount',
  },
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({ dapp: { disconnect: jest.fn() } }),
  notificationManager: {
    cleanup: jest.fn(),
    notifyAccountChange: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
    notifyNetworkChange: jest.fn(),
  },
}));
jest.mock('hooks/index', () => ({
  usePrice: jest.requireActual('hooks/usePrice').usePrice,
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn(), isUnlocked: true }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', state: null }),
}));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ArrowDownLoadSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  FaucetAccessModal: () => null,
  FaucetFirstAccessModal: () => null,
}));
jest.mock(
  'components/Loader/SkeletonLoader',
  () =>
    function SkeletonLoaderMock() {
      return <span data-skeleton />;
    }
);
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('components/Modal/WalletProviderDafault', () => ({
  WalletProviderDefaultModal: () => null,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  ConnectHardwareWallet: () => null,
}));
jest.mock('pages/Home/TxsPanel', () => ({ TxsPanel: () => null }));

const type = KeyringAccountType.HDAccount;
const networks = {
  ethereum: [
    {
      kind: 'ethereum',
      chainId: 1,
      currency: 'ETH',
      slip44: 60,
      url: 'https://first.invalid',
    },
    {
      kind: 'ethereum',
      chainId: 137,
      currency: 'POL',
      slip44: 60,
      url: 'https://next.invalid',
    },
  ],
  syscoin: [
    {
      kind: 'syscoin',
      chainId: 57,
      currency: 'SYS',
      slip44: 57,
      url: 'https://first.invalid',
    },
    {
      kind: 'syscoin',
      chainId: 0,
      currency: 'BTC',
      slip44: 0,
      url: 'https://next.invalid',
    },
  ],
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
let controller: any;
let quote: jest.Mock;

const initialize = (kind: keyof typeof networks = 'ethereum') => {
  const [first, next] = networks[kind];
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
        isBitcoinBased: kind === 'syscoin',
        activeAccount: { id: 0, type },
        accounts: {
          ...vault.accounts,
          HDAccount: {
            0: {
              id: 0,
              address:
                kind === 'ethereum' ? `0x${'11'.repeat(20)}` : 'sys1fixture',
              balances: { ethereum: 2, syscoin: 2 },
            },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: first.slip44 },
      price: { fiat: { asset: 'usd', price: 0 } },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  // A recent visit to B restores its actual native balance without waiting for
  // the next background refresh. This is the real reducer/cache path.
  mockStore.dispatch(
    setAccountBalanceForNetwork({
      id: 0,
      type,
      network: next as any,
      balance: 2,
    })
  );
  quote = jest.fn();
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    assetUpdateRequestId: 0,
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    activeRapidPolls: new Map(),
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    receiptBalanceRefresh: { cancel: jest.fn() },
    cancellablePromises: new CancellablePromises(),
    getActiveKeyring: () => ({ isUnlocked: () => true }),
    getTokenPriceData: quote,
    getUtxoPriceData: quote,
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
    handleNetworkChangeError: jest.fn(),
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    isStartingUp: true,
    // Isolate signer/network I/O only. Keep public setActiveNetwork, the real
    // success handler, account compatibility checks, mutex and Redux reducers.
    setActiveNetworkLogic: (network: any, resolve: () => void) => {
      mockStore.dispatch(startSwitchNetwork(network));
      resolve();
    },
  });
  return { first, next };
};

const VisibleHome = () => {
  const loading = usePageLoadingState();
  return (
    <div data-loading={loading.isLoading}>
      <Home />
    </div>
  );
};
const home = () =>
  renderToStaticMarkup(
    <Provider store={mockStore}>
      <VisibleHome />
    </Provider>
  );
const transaction = () =>
  renderToStaticMarkup(
    <Provider store={mockStore}>
      <FiatComponent transactionValue="2000000000000000000" />
    </Provider>
  );

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'true' },
  });
});
afterEach(() => jest.restoreAllMocks());

it.each(['ethereum', 'syscoin'] as const)(
  'applies the current %s quote and currency',
  async (kind) => {
    const { first } = initialize(kind);
    quote.mockResolvedValue({ price: 99, priceChange24h: 8 });
    await controller.setFiat('eur');
    expect(quote).toHaveBeenCalledWith(
      kind === 'ethereum' ? first.chainId : first.url,
      'eur'
    );
    expect(mockStore.getState().price.fiat).toEqual({
      asset: 'eur',
      price: 99,
      priceChange24h: 8,
    });
    expect(transaction()).toContain('198 EUR');
  }
);

it.each(['ethereum', 'syscoin'] as const)(
  'keeps the current %s failure fallback',
  async (kind) => {
    initialize(kind);
    quote.mockRejectedValue(new Error('synthetic price failure'));
    await controller.setFiat('eur');
    expect(mockStore.getState().price.fiat).toEqual({ asset: 'eur', price: 0 });
  }
);

it.each(
  (['ethereum', 'syscoin'] as const).flatMap((kind) => [
    { kind, failed: false },
    { kind, failed: true },
  ])
)(
  'ignores late $kind quotes after a public network switch (failed=$failed)',
  async ({ kind, failed }) => {
    const { next } = initialize(kind);
    const old = deferred<{ price: number; priceChange24h: number }>();
    const fresh = deferred<{ price: number; priceChange24h: number }>();
    quote.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const oldUpdate = controller.setFiat('usd');
    await flush();
    await controller.setActiveNetwork(next);
    expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
    expect(
      mockStore.getState().vault.accounts.HDAccount[0].balances[kind]
    ).toBe(2);
    const dispatch = jest.spyOn(mockStore, 'dispatch');
    if (failed) old.reject(new Error('superseded quote failed'));
    else old.resolve({ price: 99, priceChange24h: 8 });
    await oldUpdate;
    await flush();
    try {
      expect(quote).toHaveBeenCalledTimes(2);
      expect(
        dispatch.mock.calls.filter(
          ([action]: any) => action.type === 'price/setPrices'
        )
      ).toHaveLength(0);
      expect(mockStore.getState().price.fiat.price).toBe(0);
      // No overlay hides this case: B's recent native balance is already known.
      expect(home()).toContain('data-loading="false"');
      expect(home()).toContain('id="home-balance"');
      expect(home()).toContain(`>${next.currency}</p>`);
      expect(home()).not.toContain('$198 USD');
      expect(home()).not.toContain('8.00%');
      expect(transaction()).not.toContain('198 USD');
    } finally {
      fresh.resolve({ price: 2, priceChange24h: 1 });
      await flush();
    }
    expect(mockStore.getState().price.fiat.price).toBe(2);
    expect(home()).toContain('$4 USD');
  }
);

it.each(['ethereum', 'syscoin'] as const)(
  'clears an already-cached %s quote only when the new network commits',
  async (kind) => {
    const { next } = initialize(kind);
    quote.mockResolvedValueOnce({ price: 99, priceChange24h: 8 });
    await controller.setFiat('eur');
    const fresh = deferred<{ price: number }>();
    quote.mockReturnValueOnce(fresh.promise);
    await controller.setActiveNetwork(next);
    try {
      expect(mockStore.getState().price.fiat).toEqual({
        asset: 'eur',
        price: 0,
      });
      expect(home()).not.toContain('€198 EUR');
    } finally {
      fresh.resolve({ price: 2 });
      await flush();
    }
    expect(mockStore.getState().price.fiat).toEqual({ asset: 'eur', price: 2 });
  }
);

it('preserves the existing quote when network configuration fails', async () => {
  const { next } = initialize();
  quote.mockResolvedValue({ price: 99, priceChange24h: 8 });
  await controller.setFiat('eur');
  controller.setActiveNetworkLogic = (
    _network: any,
    _resolve: any,
    reject: any
  ) => reject(new Error('synthetic network failure'));
  await expect(controller.setActiveNetwork(next)).rejects.toThrow(
    'synthetic network failure'
  );
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'eur',
    price: 99,
    priceChange24h: 8,
  });
});

it.each(
  (['ethereum', 'syscoin'] as const).flatMap((kind) =>
    ['url', 'apiUrl', 'coingeckoId'].map((endpoint) => ({ kind, endpoint }))
  )
)(
  'invalidates a cached $kind quote when only $endpoint changes',
  async ({ kind, endpoint }) => {
    const { first } = initialize(kind);
    quote.mockResolvedValueOnce({ price: 99, priceChange24h: 8 });
    await controller.setFiat('eur');
    const fresh = deferred<{ price: number }>();
    quote.mockReturnValueOnce(fresh.promise);
    await controller.setActiveNetwork({
      ...first,
      [endpoint]:
        endpoint === 'coingeckoId'
          ? 'changed-native-asset'
          : 'https://changed.invalid',
    });
    try {
      expect(mockStore.getState().price.fiat).toEqual({
        asset: 'eur',
        price: 0,
      });
    } finally {
      fresh.resolve({ price: 2 });
      await flush();
    }
  }
);

it('retains a valid cached quote during an unchanged-network retry', async () => {
  const { first } = initialize();
  quote.mockResolvedValueOnce({ price: 99, priceChange24h: 8 });
  await controller.setFiat('eur');
  const fresh = deferred<{ price: number }>();
  quote.mockReturnValueOnce(fresh.promise);
  await controller.setActiveNetwork(first);
  try {
    expect(mockStore.getState().price.fiat).toEqual({
      asset: 'eur',
      price: 99,
      priceChange24h: 8,
    });
  } finally {
    fresh.resolve({ price: 2 });
    await flush();
  }
});

it('commits only quote fields and retains the requested currency', async () => {
  initialize();
  quote.mockResolvedValue({
    asset: 'jpy',
    price: 3,
    priceChange24h: 1,
    unrelated: true,
  });
  await controller.setFiat('eur');
  expect(mockStore.getState().price.fiat).toEqual({
    asset: 'eur',
    price: 3,
    priceChange24h: 1,
  });
});

it('does not accept an A quote started while B configuration is pending', async () => {
  const { next } = initialize();
  let finishSwitch!: () => void;
  controller.setActiveNetworkLogic = (network: any, resolve: () => void) => {
    mockStore.dispatch(startSwitchNetwork(network));
    finishSwitch = resolve;
  };
  const old = deferred<{ price: number }>();
  const fresh = deferred<{ price: number }>();
  quote.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const switching = controller.setActiveNetwork(next);
  const updating = controller.setFiat();
  await flush();
  expect(quote).toHaveBeenCalledWith(1, 'usd');
  finishSwitch();
  await switching;
  old.resolve({ price: 99 });
  await updating;
  await flush();
  try {
    expect(mockStore.getState().price.fiat.price).toBe(0);
    expect(home()).not.toContain('$198 USD');
  } finally {
    fresh.resolve({ price: 2 });
    await flush();
  }
});

it('keeps explicit currency intent for the queued new-network quote without relabeling the old price', async () => {
  const { next } = initialize();
  const old = deferred<{ price: number }>();
  const fresh = deferred<{ price: number }>();
  quote.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const updating = controller.setFiat('eur');
  await flush();
  expect(mockStore.getState().price.fiat).toEqual({ asset: 'eur', price: 0 });
  await controller.setActiveNetwork(next);
  old.resolve({ price: 99 });
  await updating;
  await flush();
  try {
    expect(quote).toHaveBeenLastCalledWith(137, 'eur');
    expect(mockStore.getState().price.fiat).toEqual({ asset: 'eur', price: 0 });
  } finally {
    fresh.resolve({ price: 2 });
    await flush();
  }
  expect(mockStore.getState().price.fiat).toEqual({ asset: 'eur', price: 2 });
});

it('retains a valid in-flight quote and explicit currency when a different-network attempt fails', async () => {
  const { next } = initialize();
  const pending = deferred<{ price: number }>();
  quote.mockReturnValueOnce(pending.promise);
  const updating = controller.setFiat('eur');
  await flush();
  controller.setActiveNetworkLogic = (
    _network: any,
    _resolve: any,
    reject: any
  ) => reject(new Error('switch failed'));
  await expect(controller.setActiveNetwork(next)).rejects.toThrow(
    'switch failed'
  );
  pending.resolve({ price: 4 });
  await updating;
  expect(mockStore.getState().price.fiat).toEqual({ asset: 'eur', price: 4 });
});

it('does not commit an in-flight quote after the wallet session is invalidated', async () => {
  initialize();
  const pending = deferred<{ price: number }>();
  quote.mockReturnValueOnce(pending.promise);
  const updating = controller.setFiat();
  await flush();
  // Lock/reset both invalidate this existing epoch before their asynchronous I/O.
  controller.walletSessionGeneration += 1;
  pending.resolve({ price: 99 });
  await updating;
  expect(mockStore.getState().price.fiat.price).toBe(0);
});

it('ignores an EVM quote whose registry price source changed while it was loading', async () => {
  const { first } = initialize();
  const pending = deferred<{ price: number }>();
  quote.mockReturnValueOnce(pending.promise);
  const updating = controller.setFiat();
  await flush();
  mockStore.dispatch(
    setNetwork({
      network: { ...first, coingeckoId: 'changed-native-asset' } as any,
    })
  );
  pending.resolve({ price: 99 });
  await updating;
  expect(mockStore.getState().price.fiat.price).toBe(0);
});
