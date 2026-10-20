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

it.each([
  ['absent', undefined],
  ['plain', { en: 'Plain token description' }],
  ['HTML text', { en: 'A <b>plain</b> description' }],
  ['empty text', { en: '' }],
  ['null locale', { en: null }],
  ['number', { en: 42 }],
  ['array', { en: ['Not a plain-text description'] }],
  ['object', { en: { summary: 'Malformed optional metadata' } }],
])(
  'keeps usable remote price and real Details controls with %s description',
  async (_label, description) => {
    const remote = {
      id: 'synthetic-token',
      symbol: 'syn',
      name: 'Synthetic token',
      description,
      // eslint-disable-next-line camelcase
      market_data: {
        // eslint-disable-next-line camelcase
        current_price: { usd: 55 },
        // eslint-disable-next-line camelcase
        price_change_percentage_24h: 0,
      },
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
    render(
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
    await waitFor(() => expect(screen.getByText('$55')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'buttons.close' })).toBeEnabled();
    if (typeof description?.en === 'string' && description.en) {
      expect(screen.getByText(description.en)).toBeInTheDocument();
      expect(document.querySelector('b')).toBeNull();
    } else {
      expect(screen.queryByText('tokens.about')).toBeNull();
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }
);
