/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import price, { setPrices } from 'state/price';
import vault, {
  setAccountBalanceForNetwork,
  setAccountBalances,
  setNetworkChange,
} from 'state/vault';
import vaultGlobal from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import {
  getFreshNativeBalance,
  NATIVE_BALANCE_CACHE_TTL_MS,
} from 'utils/nativeBalanceCache';

import { Home } from './Home';

let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
    subscribe: (listener: () => void) => mockStore.subscribe(listener),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('hooks/index', () => ({
  usePrice: jest.requireActual('hooks/usePrice').usePrice,
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn(), isUnlocked: true }),
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
      return <span data-skeleton="true" />;
    }
);
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('components/Modal/WalletProviderDafault', () => ({
  WalletProviderDefaultModal: () => null,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  ConnectHardwareWallet: () => null,
}));
jest.mock('./TxsPanel', () => ({ TxsPanel: () => null }));

const network = {
  kind: INetworkType.Ethereum,
  chainId: 5700,
  slip44: 60,
  url: 'https://quote.synthetic.invalid',
  currency: 'SYS',
  label: 'Synthetic market network',
  coingeckoId: 'synthetic-native',
};
let wallet: any;
let quotes: Record<string, number>;
let balanceRead: jest.Mock;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'true' },
  });
  const initialVault = vault(undefined, { type: 'init' });
  const initialGlobal = vaultGlobal(undefined, { type: 'init' });
  mockStore = configureStore({
    reducer: combineReducers({ vault, vaultGlobal, price }),
    preloadedState: {
      vault: {
        ...initialVault,
        activeNetwork: network,
        isBitcoinBased: false,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        accounts: {
          ...initialVault.accounts,
          HDAccount: {
            0: {
              id: 0,
              address: `0x${'11'.repeat(20)}`,
              xpub: 'synthetic-public-root',
              balances: { ethereum: -1, syscoin: -1 },
            },
          },
        },
      },
      vaultGlobal: {
        ...initialGlobal,
        activeSlip44: 60,
        networks: { ...initialGlobal.networks, ethereum: { 5700: network } },
      },
      price: { fiat: { asset: 'usd', price: 0 } },
    } as any,
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  quotes = { usd: 0.125, eur: 0.2, jpy: 0.01 };
  globalThis.fetch = jest.fn(async (url, options) => {
    const requested = new URL(String(url));
    expect(requested.origin + requested.pathname).toBe(
      'https://api.coingecko.com/api/v3/simple/price'
    );
    expect(requested.searchParams.get('ids')).toBe('synthetic-native');
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
    });
    const currency = requested.searchParams.get('vs_currencies')!;
    return {
      ok: true,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          'synthetic-native': { [currency]: quotes[currency] },
        }),
    } as unknown as Response;
  });
  balanceRead = jest.fn();
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    fiatQuoteGeneration: 0,
    walletStateGeneration: 0,
    nativeBalanceRevision: 0,
    networkRequestGeneration: 0,
    balanceLoadingRequestId: 0,
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    cancellablePromises: new CancellablePromises(),
    evmAssetsController: EvmAssetsController(),
    balancesManager: { utils: { getBalanceUpdatedForAccount: balanceRead } },
    getActiveKeyring: () => ({
      isUnlocked: () => true,
      ethereumTransaction: { web3Provider: {} },
    }),
  });
});
afterEach(() => {
  cleanup();
  for (const [url, options] of jest.mocked(globalThis.fetch).mock.calls) {
    const requested = new URL(String(url));
    expect(requested.origin + requested.pathname).toBe(
      'https://api.coingecko.com/api/v3/simple/price'
    );
    expect(requested.searchParams.get('ids')).toBe('synthetic-native');
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
    });
  }
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});
const show = async (balance: string, currency: string) => {
  balanceRead.mockResolvedValue(balance);
  await wallet.updateUserNativeBalance({
    activeAccount: mockStore.getState().vault.activeAccount,
    activeNetwork: network,
    isBitcoinBased: false,
  });
  await wallet.setFiat(currency);
  const view = render(
    <Provider store={mockStore}>
      <Home />
    </Provider>
  );
  return {
    view,
    fiat: () =>
      view.container.querySelector('p.text-sm.text-brand-graylight')
        ?.textContent,
  };
};

it('keeps native availability bound to the selected endpoint while restoring its own fresh cache', async () => {
  const { view } = await show('12.34', 'usd');
  const otherEndpoint = {
    ...network,
    url: 'https://other-quote.synthetic.invalid',
  };
  const balance = () =>
    view.container.querySelector('#home-balance')?.textContent;
  const send = () => screen.getByRole('button', { name: 'buttons.send' });
  expect(balance()).toBe('12.34');
  act(() =>
    mockStore.dispatch(setNetworkChange({ activeNetwork: otherEndpoint }))
  );
  const account = mockStore.getState().vault.accounts.HDAccount[0];
  expect(account.balances.ethereum).toBe(-1);
  expect(getFreshNativeBalance(account, otherEndpoint)).toBeNull();
  expect(balance()).toBeUndefined();
  expect(view.container.querySelector('#home-balance-pending')).not.toBeNull();
  expect(send()).toBeDisabled();
  act(() => mockStore.dispatch(setNetworkChange({ activeNetwork: network })));
  expect(balance()).toBe('12.34');
  expect(send()).not.toBeDisabled();
  act(() =>
    mockStore.dispatch(setNetworkChange({ activeNetwork: otherEndpoint }))
  );
  act(() =>
    mockStore.dispatch(
      setAccountBalanceForNetwork({
        network: otherEndpoint,
        id: 0,
        type: KeyringAccountType.HDAccount,
        balance: '0',
      })
    )
  );
  expect(balance()).toBe('0');
  expect(view.container.querySelector('#home-balance-pending')).toBeNull();
  expect(send()).not.toBeDisabled();
});

it('preserves healthy same-endpoint refresh continuity only within the canonical cache lifetime', async () => {
  const { view } = await show('12.34', 'usd');
  const balance = () =>
    view.container.querySelector('#home-balance')?.textContent;
  act(() =>
    mockStore.dispatch(setAccountBalances({ ethereum: -1, syscoin: -1 }))
  );
  expect(balance()).toBe('12.34');
  expect(
    screen.getByRole('button', { name: 'buttons.send' })
  ).not.toBeDisabled();
  act(() =>
    mockStore.dispatch(
      setAccountBalanceForNetwork({
        network,
        id: 0,
        type: KeyringAccountType.HDAccount,
        balance: '12.34',
        updatedAt: Date.now() - NATIVE_BALANCE_CACHE_TTL_MS,
      })
    )
  );
  act(() =>
    mockStore.dispatch(setAccountBalances({ ethereum: -1, syscoin: -1 }))
  );
  expect(balance()).toBeUndefined();
  expect(screen.getByRole('button', { name: 'buttons.send' })).toBeDisabled();
});

it.each([
  ['1000000', 'usd', '$125K USD'],
  ['1000000', 'eur', '€200K EUR'],
  ['1000000', 'jpy', '¥10K JPY'],
])(
  'keeps fiat units for ordinary large balance %s in %s',
  async (balance, currency, expected) => {
    const { fiat } = await show(balance, currency);
    expect(balanceRead).toHaveBeenCalledTimes(1);
    expect(mockStore.getState().price.fiat).toMatchObject({
      asset: currency,
      price: quotes[currency],
    });
    expect(fiat()).toBe(expected);
  }
);

it('healthy: retains exact fiat units below the native million threshold', async () => {
  const { fiat } = await show('999999', 'usd');
  expect(fiat()).toBe('$124999.875 USD');
});

it('healthy: retains actual zero quote units for a large native balance', async () => {
  quotes.usd = 0;
  const { fiat } = await show('1000000', 'usd');
  expect(fiat()).toBe('$0 USD');
});

it('keeps the current fiat unit after a normal quote-currency publication into the same Home', async () => {
  const { fiat } = await show('1000000', 'usd');
  expect(fiat()).toBe('$125K USD');
  await act(async () => wallet.setFiat('eur'));
  expect(mockStore.getState().price.fiat).toMatchObject({
    asset: 'eur',
    price: 0.2,
  });
  expect(fiat()).toBe('€200K EUR');
});

it('preserves a finite negative quote sign along with fiat units', async () => {
  quotes.usd = -0.125;
  const { fiat } = await show('1000000', 'usd');
  expect(fiat()).toBe('$-125K USD');
});

it('marks a missing price unavailable without changing the native balance', async () => {
  delete quotes.usd;
  const { fiat } = await show('1000000', 'usd');
  expect(mockStore.getState().price.fiat).toMatchObject({
    price: 0,
    available: false,
  });
  expect(fiat()).toBe('settings.unavailable');
  expect(document.querySelector('#home-balance')?.textContent).toBe('1M');
});

it('retains a cryptocurrency unit when the converted amount is small', async () => {
  quotes.btc = 0.000001;
  const { fiat } = await show('1000000', 'btc');
  expect(fiat()).toBe('₿1 BTC');
});

it('recovers a missing quote to a genuine zero quote on the same Home', async () => {
  delete quotes.usd;
  const { fiat, view } = await show('2', 'usd');
  expect(fiat()).toBe('settings.unavailable');
  const native = view.container.querySelector('#home-balance');
  expect(native?.textContent).toBe('2');
  quotes.usd = 0;
  await act(async () => wallet.setFiat());
  expect(mockStore.getState().price.fiat).toMatchObject({
    available: true,
    price: 0,
  });
  expect(fiat()).toBe('$0 USD');
  expect(view.container.querySelector('#home-balance')).toBe(native);
  expect(native?.textContent).toBe('2');
});

it('hides an unavailable quote and its stale 24-hour change while preserving native funds', async () => {
  const { fiat, view } = await show('2', 'usd');
  await act(async () =>
    mockStore.dispatch(
      setPrices({
        asset: 'usd',
        price: 0.125,
        available: false,
        priceChange24h: 99,
      })
    )
  );
  expect(fiat()).toBe('settings.unavailable');
  expect(view.container.textContent).not.toContain('99.00% (24h)');
  expect(view.container.querySelector('#home-balance')?.textContent).toBe('2');
  await act(async () =>
    mockStore.dispatch(
      setPrices({
        asset: 'usd',
        price: -1,
        available: true,
        priceChange24h: -1,
      })
    )
  );
  expect(fiat()).toBe('$-2 USD');
  expect(view.container.textContent).toContain('-1.00% (24h)');
});
