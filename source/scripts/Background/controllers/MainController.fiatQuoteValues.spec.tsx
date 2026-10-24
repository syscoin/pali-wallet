/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { retryableFetch } from '@sidhujag/sysweb3-network';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import React from 'react';
import { Provider, useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance/LazyAccountBalance';
import { usePrice } from 'hooks/usePrice';
import price from 'state/price';
import vault, { setAccountBalanceForNetwork } from 'state/vault';
import vaultGlobal from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import EvmAssetsController from './assets/evm';
import MainController from './MainController';

let mockStore: any;
const mockBalanceRead = jest.fn(() => {
  throw new Error('A fresh native balance must not request RPC data');
});
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
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockBalanceRead }),
}));

const network = (kind: INetworkType) => ({
  kind,
  chainId: kind === INetworkType.Ethereum ? 1 : 57,
  slip44: kind === INetworkType.Ethereum ? 60 : 57,
  url: 'https://quote.synthetic.invalid',
  currency: kind === INetworkType.Ethereum ? 'ETH' : 'SYS',
  label: 'Synthetic fiat quote',
  coingeckoId: 'synthetic-native',
});

class BalanceBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <p>Quote crashed balance display</p>
    ) : (
      this.props.children
    );
  }
}

const AccountRow = () => {
  const account = useSelector(
    (state: any) => state.vault.accounts.HDAccount[0]
  );
  return (
    <LazyAccountBalance
      account={account}
      accountType={KeyringAccountType.HDAccount}
    />
  );
};

const showBalance = () =>
  render(
    <Provider store={mockStore}>
      <BalanceBoundary>
        <AccountRow />
      </BalanceBoundary>
    </Provider>
  );

const prepare = (kind: INetworkType, firstWireValue: string) => {
  const net = network(kind);
  const initialVault = vault(undefined, { type: 'test/init' });
  const initialGlobal = vaultGlobal(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: combineReducers({ vault, vaultGlobal, price }),
    preloadedState: {
      vault: {
        ...initialVault,
        activeNetwork: net,
        isBitcoinBased: kind === INetworkType.Syscoin,
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        accounts: {
          ...initialVault.accounts,
          HDAccount: {
            0: { id: 0, address: `0x${'11'.repeat(20)}`, xpub: 'public' },
          },
        },
      },
      vaultGlobal: {
        ...initialGlobal,
        activeSlip44: net.slip44,
        networks: {
          ...initialGlobal.networks,
          ethereum: { 1: network(INetworkType.Ethereum) },
        },
      },
      price: { fiat: { asset: 'usd', price: 0 } },
    } as any,
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  mockStore.dispatch(
    setAccountBalanceForNetwork({
      id: 0,
      type: KeyringAccountType.HDAccount,
      network: net,
      balance: '2',
      updatedAt: Date.now(),
    })
  );
  const wallet: any = Object.create(MainController.prototype);
  Object.assign(wallet, {
    fiatQuoteGeneration: 0,
    walletStateGeneration: 0,
    evmAssetsController: EvmAssetsController(),
    utxoPriceDataCache: new Map(),
    UTXO_PRICE_CACHE_DURATION: 300000,
  });
  let wireValue = firstWireValue;
  jest.mocked(retryableFetch).mockImplementation(async (url: any) => {
    if (kind === INetworkType.Ethereum) {
      expect(String(url)).toBe(
        'https://api.coingecko.com/api/v3/simple/price?ids=synthetic-native&vs_currencies=eur&include_24hr_change=true'
      );
    } else {
      expect(String(url)).toBe(
        'https://quote.synthetic.invalid/api/v2/tickers/currency'
      );
    }
    const fields = `"eur":${wireValue}`;
    const body =
      kind === INetworkType.Ethereum
        ? `{"synthetic-native":{${fields},"eur_24h_change":-0.5}}`
        : `{"rates":{${fields}}}`;
    // Exercise the real readers on JSON-decoded wire data, including a valid
    // JSON number whose magnitude is not finite in JavaScript.
    return { ok: true, json: async () => JSON.parse(body) } as Response;
  });
  return {
    wallet,
    setWireValue: (value: string) => {
      wireValue = value;
    },
    read: () =>
      kind === INetworkType.Ethereum
        ? wallet.getTokenPriceData(net.chainId, 'eur')
        : wallet.getUtxoPriceData(net.url, 'eur'),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  expect(mockBalanceRead).not.toHaveBeenCalled();
});

const cases = [
  ['ordinary quote', '13', 13, '26 EUR', true],
  ['real zero', '0', 0, '0 EUR', true],
  ['finite negative quote', '-13', -13, '-26 EUR', true],
  ['positive wire overflow', '9e9999', 0, '0 EUR', false],
  ['negative wire overflow', '-9e9999', 0, '0 EUR', false],
  ['finite multiplication overflow', '1e308', 1e308, '0 EUR', true],
  ['nonnumeric string', '"unavailable"', 0, '0 EUR', false],
  ['numeric string', '"13"', 0, '0 EUR', false],
  ['null', 'null', 0, '0 EUR', false],
  ['boolean', 'true', 0, '0 EUR', false],
  ['array', '[13]', 0, '0 EUR', false],
  ['object', '{"value":13}', 0, '0 EUR', false],
] as const;

describe.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  '%s fiat quote values through the real reader, controller and balance row',
  (kind) => {
    it.each(cases)(
      'handles %s',
      async (_name, wire, quote, expected, available) => {
        const { wallet } = prepare(kind, wire);
        await wallet.setFiat('eur');
        expect(mockStore.getState().price.fiat).toMatchObject({
          asset: 'eur',
          available,
          price: quote,
        });
        expect(Number.isFinite(mockStore.getState().price.fiat.price)).toBe(
          true
        );
        showBalance();
        expect(screen.queryByText('Quote crashed balance display')).toBeNull();
        const format = renderHook(() => usePrice(), {
          wrapper: ({ children }: React.PropsWithChildren) => (
            <Provider store={mockStore}>{children}</Provider>
          ),
        });
        // Preserve the formatter's numerical contract, even when UI hides a
        // quote that was never received. Zero and negative quotes remain valid.
        expect(format.result.current.getFiatAmount(2, 4, 'EUR')).toBe(expected);
        expect(format.result.current.isFiatAvailable).toBe(available);
        expect(
          await screen.findByText(available ? expected : '--')
        ).toBeVisible();
      }
    );

    it.each([
      '9e9999',
      '-9e9999',
      '"unavailable"',
      '"13"',
      'null',
      'true',
      '[13]',
      '{"value":13}',
    ])(
      'does not cache malformed wire value %s and publishes its recovered quote',
      async (wire) => {
        const { wallet, setWireValue } = prepare(kind, wire);
        await wallet.setFiat('eur');
        expect(mockStore.getState().price.fiat.price).toBe(0);
        showBalance();
        expect(mockStore.getState().price.fiat.available).toBe(false);
        expect(await screen.findByText('--')).toBeVisible();
        setWireValue('13');
        await act(async () => wallet.setFiat('eur'));
        expect(retryableFetch).toHaveBeenCalledTimes(2);
        expect(mockStore.getState().price.fiat.price).toBe(13);
        expect(mockStore.getState().price.fiat.available).toBe(true);
        expect(screen.queryByText('Quote crashed balance display')).toBeNull();
        expect(await screen.findByText('26 EUR')).toBeVisible();
      }
    );

    it('retains the five-minute cache boundary for a finite quote', async () => {
      let now = 1000000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const { read, setWireValue } = prepare(kind, '13');
      expect((await read()).price).toBe(13);
      expect((await read()).available).toBe(true);
      setWireValue('17');
      now += 299999;
      expect((await read()).price).toBe(13);
      expect((await read()).available).toBe(true);
      expect(retryableFetch).toHaveBeenCalledTimes(1);
      now += 1;
      expect((await read()).price).toBe(17);
      expect(retryableFetch).toHaveBeenCalledTimes(2);
    });

    it('retains optional price-change metadata on a valid quote', async () => {
      const { read } = prepare(kind, '13');
      expect(await read()).toEqual({
        available: true,
        price: 13,
        priceChange24h: kind === INetworkType.Ethereum ? -0.5 : undefined,
      });
    });

    it('preserves the existing zero-quote caching policy', async () => {
      const { read, setWireValue } = prepare(kind, '0');
      const zeroQuote = await read();
      expect(zeroQuote.price).toBe(0);
      expect(zeroQuote.available).toBe(true);
      setWireValue('13');
      expect((await read()).price).toBe(
        kind === INetworkType.Ethereum ? 0 : 13
      );
      expect(retryableFetch).toHaveBeenCalledTimes(
        kind === INetworkType.Ethereum ? 1 : 2
      );
    });

    it.each(['missing rate', 'transport failure'])(
      'marks %s unavailable without caching the failed quote',
      async (failure) => {
        const { wallet } = prepare(kind, '13');
        if (failure === 'transport failure') {
          jest
            .mocked(retryableFetch)
            .mockRejectedValueOnce(new Error('Synthetic quote refusal'));
        } else {
          jest.mocked(retryableFetch).mockResolvedValueOnce({
            ok: true,
            json: async () =>
              kind === INetworkType.Ethereum
                ? { 'synthetic-native': { usd: 4 } }
                : { rates: { usd: 4 } },
          } as Response);
        }
        await wallet.setFiat('eur');
        expect(mockStore.getState().price.fiat).toEqual({
          asset: 'eur',
          available: false,
          price: 0,
          priceChange24h: undefined,
        });
        showBalance();
        expect(await screen.findByText('--')).toBeVisible();
        await act(async () => wallet.setFiat('eur'));
        expect(mockStore.getState().price.fiat).toMatchObject({
          asset: 'eur',
          available: true,
          price: 13,
        });
        expect(await screen.findByText('26 EUR')).toBeVisible();
        expect(retryableFetch).toHaveBeenCalledTimes(2);
      }
    );
  }
);
