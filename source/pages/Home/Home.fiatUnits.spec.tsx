/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { retryableFetch } from '@sidhujag/sysweb3-network';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import price from 'state/price';
import vault from 'state/vault';
import vaultGlobal from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { Home } from './Home';

let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('@sidhujag/sysweb3-network', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-network'),
  retryableFetch: jest.fn(),
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
  globalThis.fetch = jest.fn(() => {
    throw new Error('Real network is denied');
  }) as any;
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
  jest.mocked(retryableFetch).mockImplementation(async (url: any) => {
    const requested = new URL(String(url));
    expect(requested.origin + requested.pathname).toBe(
      'https://api.coingecko.com/api/v3/simple/price'
    );
    expect(requested.searchParams.get('ids')).toBe('synthetic-native');
    const currency = requested.searchParams.get('vs_currencies')!;
    return {
      ok: true,
      json: async () => ({
        'synthetic-native': { [currency]: quotes[currency] },
      }),
    } as Response;
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
  expect(globalThis.fetch).not.toHaveBeenCalled();
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

it('keeps missing-price fallback explicitly denominated', async () => {
  delete quotes.usd;
  const { fiat } = await show('1000000', 'usd');
  expect(mockStore.getState().price.fiat.price).toBe(0);
  expect(fiat()).toBe('$0 USD');
});

it('retains a cryptocurrency unit when the converted amount is small', async () => {
  quotes.btc = 0.000001;
  const { fiat } = await show('1000000', 'btc');
  expect(fiat()).toBe('₿1 BTC');
});
