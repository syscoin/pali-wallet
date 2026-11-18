/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import {
  clearTokenIconCache,
  preloadTokenIcons,
  TokenIcon,
} from 'components/TokenIcon';
import { DetailsView } from 'pages/Home/Panel/components/Details';
import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import vaultReducer, { setAccountAssets } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

let mockStore: any;
const mockEmitter = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
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
  NftFallbackSvg: () => <span data-testid="nft-fallback" />,
  LoadingOutlined: () => null,
  Icon: () => null,
}));
jest.mock('pages/Home/Panel/components/TransactionDetails', () => ({
  TransactionDetails: () => null,
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  formatCurrency: (value: string) => value,
  formatFullPrecisionBalance: (value: string) => String(value),
  adjustUrl: (value: string) => value,
}));

const ADDRESS = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const originalFetch = global.fetch;
const network = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  url: 'https://synthetic.invalid',
  explorer: 'https://explorer.invalid/',
  coingeckoPlatformId: 'ethereum',
};
const token = {
  id: `${CONTRACT}-1`,
  contractAddress: CONTRACT,
  chainId: 1,
  tokenSymbol: 'SYN',
  name: 'Synthetic token',
  balance: 42,
  decimals: 18,
  tokenStandard: 'ERC-20',
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
  clearTokenIconCache();
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
        isBitcoinBased: false,
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: {
            0: { id: 0, address: ADDRESS, xpub: 'synthetic-public' },
          },
        },
        accountAssets: { HDAccount: { 0: { ethereum: [token], syscoin: [] } } },
        accountTransactions: {
          HDAccount: { 0: { ethereum: {}, syscoin: {} } },
        },
      } as any,
    },
  });
  const assets = EvmAssetsController();
  mockEmitter.mockImplementation(([, method], args) => {
    if (method !== 'getOnlyMarketData')
      throw new Error(`Unexpected call ${method}`);
    return assets.getOnlyMarketData(args[0]);
  });
});
afterEach(() => {
  clearTokenIconCache();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const LOGO = 'https://icons.synthetic.invalid/public-token.png';
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
    'base64'
  )
);
const imageResponse = (ok = true, bytes = png): Response => {
  let sent = false;
  const cancel = async () => undefined;
  return {
    ok,
    headers: {
      get: (name: string) => (name === 'content-type' ? 'image/png' : null),
    },
    body: {
      cancel,
      getReader: () => ({
        cancel,
        read: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: bytes };
        },
      }),
    },
  } as unknown as Response;
};
const display = () =>
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
const installImage = (ok: boolean) => {
  global.fetch = jest.fn(async (url: string) => {
    if (url === LOGO) return imageResponse(ok);
    expect(url).toBe(
      `https://api.coingecko.com/api/v3/coins/ethereum/contract/${CONTRACT}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
    );
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'synthetic-token',
        symbol: 'syn',
        image: { large: LOGO },
        // eslint-disable-next-line camelcase
        market_data: { current_price: { usd: 55 } },
      }),
    } as Response;
  }) as typeof fetch;
};
it.each([false, true])(
  'uses the correct fallback after an accepted remote image cannot decode, NFT=%s',
  async (isNft) => {
    mockStore.dispatch(
      setAccountAssets({
        accountType: KeyringAccountType.HDAccount,
        accountId: 0,
        assets: {
          syscoin: [],
          ethereum: [
            { ...token, isNft, tokenStandard: isNft ? 'ERC-721' : 'ERC-20' },
          ],
        },
      })
    );
    installImage(true);
    const view = display();
    const image = await screen.findByAltText('SYN');
    await waitFor(() =>
      expect(image).toHaveAttribute(
        'src',
        expect.stringContaining('data:image/png;')
      )
    );
    fireEvent.error(image);
    expect(image.isConnected).toBe(false);
    if (isNft) expect(screen.getByTestId('nft-fallback')).toBeInTheDocument();
    else expect(screen.getByText('S', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();
  }
);
it('retains a successful current image', async () => {
  installImage(true);
  display();
  const image = await screen.findByAltText('SYN');
  await waitFor(() =>
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/png;')
    )
  );
  fireEvent.load(image);
  expect(image.isConnected).toBe(true);
  expect(screen.queryByText('S', { exact: true })).toBeNull();
});
it('retains the existing fetch-failure fallback', async () => {
  installImage(false);
  display();
  expect(await screen.findByText('S', { exact: true })).toBeInTheDocument();
  expect(screen.queryByAltText('SYN')).toBeNull();
});

it('caches a native decode failure and permits a fresh read after the existing cooldown', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  installImage(true);
  const first = display();
  const broken = await screen.findByAltText('SYN');
  fireEvent.error(broken);
  expect(screen.getByText('S', { exact: true })).toBeInTheDocument();
  first.unmount();
  const cached = display();
  expect(await screen.findByText('S', { exact: true })).toBeInTheDocument();
  expect(
    jest.mocked(fetch).mock.calls.filter(([url]) => url === LOGO)
  ).toHaveLength(1);
  cached.unmount();

  clock.mockReturnValue(now + 5 * 60_000 + 1);
  const fetchMarket = jest.mocked(fetch).getMockImplementation()!;
  jest
    .mocked(fetch)
    .mockImplementation(async (...args) =>
      args[0] === LOGO ? imageResponse() : fetchMarket(...args)
    );
  display();
  const recovered = await screen.findByAltText('SYN');
  await waitFor(() =>
    expect(recovered).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/png;')
    )
  );
  fireEvent.load(recovered);
  expect(recovered.isConnected).toBe(true);
  expect(
    jest.mocked(fetch).mock.calls.filter(([url]) => url === LOGO)
  ).toHaveLength(2);
});

it('uses fallback for an oversized streamed image without a direct-URL retry', async () => {
  global.fetch = jest.fn(async () =>
    imageResponse(true, new Uint8Array(256 * 1024 + 1))
  );
  const view = render(<TokenIcon logo={LOGO} symbol="DIRECT" />);
  expect(await screen.findByText('D', { exact: true })).toBeInTheDocument();
  expect(view.container.querySelector('img')).toBeNull();
  expect(screen.queryByAltText('DIRECT')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'ignores an old native image error after a later success, ABA=%s',
  async (aba) => {
    global.fetch = jest.fn(async () => imageResponse());
    const next = LOGO + '?second';
    const view = render(<TokenIcon logo={LOGO} symbol="FIRST" />);
    const first = await screen.findByAltText('FIRST');
    view.rerender(<TokenIcon logo={next} symbol="SECOND" />);
    const second = await screen.findByAltText('SECOND');
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    fireEvent.error(first);
    expect(second.isConnected).toBe(true);
    if (aba) {
      view.rerender(<TokenIcon logo={LOGO} symbol="FIRST" />);
      const current = await screen.findByAltText('FIRST');
      expect(current).not.toBe(first);
      fireEvent.error(first);
      expect(current.isConnected).toBe(true);
    }
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(2);
  }
);

it('does not poison a cached image when an old node reports an error after unmount', async () => {
  global.fetch = jest.fn(async () => imageResponse());
  const view = render(<TokenIcon logo={LOGO} symbol="CURRENT" />);
  const departed = await screen.findByAltText('CURRENT');
  view.unmount();
  fireEvent.error(departed);
  render(<TokenIcon logo={LOGO} symbol="CURRENT" />);
  expect(await screen.findByAltText('CURRENT')).toHaveAttribute(
    'src',
    expect.stringContaining('data:image/png;')
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('retains native failure handling under StrictMode effect replay', async () => {
  global.fetch = jest.fn(async () => imageResponse());
  render(
    <React.StrictMode>
      <TokenIcon logo={LOGO} symbol="STRICT" />
    </React.StrictMode>
  );
  fireEvent.error(await screen.findByAltText('STRICT'));
  expect(screen.getByText('S', { exact: true })).toBeInTheDocument();
});

it.each(['rejected oversized body', 'FileReader', 'preload'])(
  'preserves the cache boundary and existing-key failure with %s insertion',
  async (insertion) => {
    const urls = Array.from(
      { length: 201 },
      (_, index) => `${LOGO}?cache-boundary=${index}`
    );
    global.fetch = jest.fn(async (url) =>
      imageResponse(
        true,
        url === urls[200] && insertion === 'rejected oversized body'
          ? new Uint8Array(256 * 1024 + 1)
          : png
      )
    );
    const full = render(
      <>
        {urls.slice(0, 200).map((logo, index) => (
          <TokenIcon key={logo} logo={logo} symbol={`CACHE${index}`} />
        ))}
      </>
    );
    await waitFor(() =>
      expect(full.container.querySelectorAll('img')).toHaveLength(200)
    );
    fireEvent.error(screen.getByAltText('CACHE199'));
    full.unmount();

    const first = render(<TokenIcon logo={urls[0]} symbol="FIRST" />);
    expect(await screen.findByAltText('FIRST')).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/png;')
    );
    expect(fetch).toHaveBeenCalledTimes(200);
    first.unmount();

    if (insertion === 'preload') await preloadTokenIcons([urls[200]]);
    else {
      const next = render(<TokenIcon logo={urls[200]} symbol="NEXT" />);
      if (insertion === 'rejected oversized body') {
        expect(
          await screen.findByText('N', { exact: true })
        ).toBeInTheDocument();
        expect(
          next.container.querySelector(`img[src="${urls[200]}"]`)
        ).toBeNull();
      } else await screen.findByAltText('NEXT');
      next.unmount();
    }
    expect(fetch).toHaveBeenCalledTimes(201);
    const retained = render(<TokenIcon logo={urls[1]} symbol="RETAINED" />);
    expect(await screen.findByAltText('RETAINED')).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/png;')
    );
    expect(fetch).toHaveBeenCalledTimes(201);
    retained.unmount();

    render(<TokenIcon logo={urls[0]} symbol="EVICTED" />);
    expect(await screen.findByAltText('EVICTED')).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/png;')
    );
    expect(fetch).toHaveBeenCalledTimes(202);
  }
);
