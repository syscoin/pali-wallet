/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { DetailsView } from 'pages/Home/Panel/components/Details';
import vaultReducer from 'state/vault';
import { INetworkType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

let mockStore: any;
const mockEmitter = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  CustomJsonRpcProvider: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-utils', () => ({
  cleanTokenSymbol: (symbol: string) => symbol,
  contractChecker: jest.fn(),
  getErc21Abi: jest.fn(),
  getTokenStandardMetadata: jest.fn(),
  getNftStandardMetadata: jest.fn(),
  getERC721StandardBalance: jest.fn(),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn(), () => true],
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { info: jest.fn(), error: jest.fn() },
  }),
  useAdjustedExplorer: (url: string) => url,
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: (url: string) => url,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  Icon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  ExternalLinkSvg: () => null,
  LoadingOutlined: () => null,
  Icon: () => null,
}));
jest.mock('pages/Home/Panel/components/TransactionDetails', () => ({
  TransactionDetails: () => null,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/tokens'),
  camelCaseToText: (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1),
  syscoinKeysOfInterest: ['symbol', 'decimals', 'balance'],
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  formatCurrency: (value: string) => value,
  formatFullPrecisionBalance: (value: string) => String(value),
  adjustUrl: (value: string) => value,
}));

const ADDRESS = `0x${'11'.repeat(20)}`;
const originalFetch = global.fetch;
const network = {
  chainId: 57,
  kind: INetworkType.Syscoin,
  url: 'https://synthetic.invalid',
  explorer: 'https://explorer.invalid/',
  label: 'Syscoin',
};
const token = {
  id: '123456',
  assetGuid: '123456',
  chainId: 57,
  symbol: 'SYSX',
  balance: '42',
  decimals: 8,
  totalSent: '0',
  totalReceived: '42',
};
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p role="alert">Market render failed: {this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      price: (value = { fiat: { asset: 'usd' } }) => value,
      vaultGlobal: (value = { activeSlip44: 60 }) => value,
    },
    preloadedState: {
      vault: {
        ...initial,
        activeNetwork: network,
        isBitcoinBased: true,
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: {
            0: { id: 0, address: ADDRESS, xpub: 'synthetic-public' },
          },
        },
        accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [token] } } },
        accountTransactions: {
          HDAccount: { 0: { ethereum: {}, syscoin: {} } },
        },
      } as any,
    },
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

/* eslint-disable camelcase -- Exact remote market JSON fields. */
it.each([
  ['valid', {}],
  ['object rank', { market_cap_rank: { value: 1 } }],
  ['null rank', { market_cap_rank: null }],
  ['object price', { market_data: { current_price: { usd: { value: 55 } } } }],
  [
    'object market cap',
    {
      market_data: {
        current_price: { usd: 55 },
        market_cap: { usd: { value: 2 } },
      },
    },
  ],
  [
    'object volume',
    {
      market_data: {
        current_price: { usd: 55 },
        total_volume: { usd: { value: 3 } },
      },
    },
  ],
  [
    'object supply',
    {
      market_data: {
        current_price: { usd: 55 },
        circulating_supply: { value: 4 },
      },
    },
  ],
  ['string price', { market_data: { current_price: { usd: '55' } } }],
  ['object id', { id: { value: 'synthetic-token' } }],
  ['uncoercible id', { id: { toString: null } }],
  [
    'uncoercible price',
    { market_data: { current_price: { usd: { toString: null } } } },
  ],
  [
    'uncoercible market cap',
    {
      market_data: {
        current_price: { usd: 55 },
        market_cap: { usd: { toString: null } },
      },
    },
  ],
  [
    'uncoercible volume',
    {
      market_data: {
        current_price: { usd: 55 },
        total_volume: { usd: { toString: null } },
      },
    },
  ],
  [
    'uncoercible supply',
    {
      market_data: {
        current_price: { usd: 55 },
        circulating_supply: { toString: null },
      },
    },
  ],
  ['object categories', { categories: { value: 'Payments' } }],
  ['object description', { description: { en: { value: 'Description' } } }],
  [
    'zero values',
    {
      market_cap_rank: 0,
      market_data: {
        current_price: { usd: 0 },
        market_cap: { usd: 0 },
        total_volume: { usd: 0 },
        circulating_supply: 0,
      },
    },
  ],
  ['blank id', { id: '' }],
  ['null id', { id: null }],
  ['numeric id', { id: 7 }],
  ['valid alternate id', { id: 'another-token' }],
  ['missing prices', { market_data: {} }],
])(
  'keeps the real Details route usable with %s market data',
  async (label, patch: any) => {
    const remote: any = {
      id: 'synthetic-token',
      symbol: 'syn',
      name: 'Synthetic token',
      market_cap_rank: 1,
      categories: ['Payments'],
      description: { en: 'Description' },
      market_data: {
        current_price: { usd: 55 },
        market_cap: { usd: 2 },
        total_volume: { usd: 3 },
        circulating_supply: 4,
        price_change_percentage_24h: 0,
      },
      ...patch,
    };
    global.fetch = jest.fn(async (url: string) => {
      expect(url).toBe(
        'https://api.coingecko.com/api/v3/coins/syscoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false'
      );
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(JSON.stringify(remote)),
      } as Response;
    }) as typeof fetch;
    const view = render(
      <Provider store={mockStore}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/home/details',
              state: { id: token.id, walletScope: getWalletNavigationScope() },
            },
          ]}
        >
          <Boundary>
            <DetailsView />
          </Boundary>
        </MemoryRouter>
      </Provider>
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(view.container.querySelector('.animate-spin')).toBeNull()
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'buttons.close' })).toBeEnabled();
    const showsMarket = true;
    if (showsMarket && typeof remote.id === 'string' && remote.id) {
      expect(
        screen.getByRole('link', { name: 'tokens.historicalData' })
      ).toHaveAttribute(
        'href',
        `https://www.coingecko.com/en/coins/${remote.id}/historical_data`
      );
    } else {
      expect(screen.queryByText('tokens.viewOnCoinGecko')).toBeNull();
      expect(
        screen.queryByRole('link', { name: 'tokens.historicalData' })
      ).toBeNull();
    }
    if (!Number.isFinite(remote.market_cap_rank))
      expect(screen.queryByText('tokens.rank')).toBeNull();
    for (const [field, title] of [
      ['current_price', 'tokens.currentPrice'],
      ['market_cap', 'tokens.marketCap'],
      ['total_volume', 'tokens.volume24h'],
      ['circulating_supply', 'tokens.circulatingSupply'],
    ]) {
      const value =
        field === 'circulating_supply'
          ? remote.market_data?.[field]
          : remote.market_data?.[field]?.usd;
      if (!Number.isFinite(value)) expect(screen.queryByText(title)).toBeNull();
    }
    if (label === 'zero values') {
      expect(screen.getByText('#0')).toBeInTheDocument();
      for (const title of [
        'tokens.currentPrice',
        'tokens.marketCap',
        'tokens.volume24h',
      ])
        expect(screen.getByText(title).parentElement).toHaveTextContent('$0');
      expect(
        screen.getByText('tokens.circulatingSupply').parentElement
      ).toHaveTextContent('0');
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }
);
/* eslint-enable camelcase */
