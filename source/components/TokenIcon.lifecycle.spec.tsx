/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { EvmAssetDetails } from 'pages/Home/Panel/components/Assets/EvmDetails';

import { clearTokenIconCache, TokenIcon } from './TokenIcon';

let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home/details', state: null }),
}));
jest.mock('hooks/useController', () => ({
  // Keep unrelated market metadata pending while exercising the real icon.
  useController: () => ({
    controllerEmitter: () => new Promise(() => undefined),
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: { info: jest.fn(), error: jest.fn() },
    navigate: jest.fn(),
  }),
  useAdjustedExplorer: () => 'https://synthetic.example/',
}));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
  Icon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  NftFallbackSvg: () => <span data-testid="nft-fallback" />,
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  formatCurrency: (value: string) => value,
  formatFullPrecisionBalance: (value: string) => value,
}));
jest.mock('utils/tokens', () => ({
  getTokenTypeBadgeColor: () => '',
  getKnownTokenLogo: () => undefined,
  sanitizeUtxoTokenLogo: (value: string) => value,
}));
jest.mock('utils/navigationState', () => ({
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  navigateBack: jest.fn(),
}));

const tokens = ['11', '22'].map((byte, index) => ({
  id: `0x${byte.repeat(20)}-57057`,
  contractAddress: `0x${byte.repeat(20)}`,
  chainId: 57057,
  tokenSymbol: `TOKEN${byte}`,
  name: `Token ${byte}`,
  balance: 4,
  decimals: 18,
  tokenStandard: 'ERC-20',
  logo: `https://icons.example/${index}.svg`,
}));
const originalFetch = globalThis.fetch;
let caseId = 0;
const reply = (ok = true) => ({
  ok,
  // Exercise the existing direct-URL path for large public icons.
  blob: async () => ({ size: 262145 }),
});
const icon = (view: ReturnType<typeof render>) =>
  view.container.querySelector('img') as HTMLImageElement;
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  clearTokenIconCache();
  caseId += 1;
  tokens.forEach((token, index) => {
    token.logo = `https://icons.example/${caseId}/${index}.svg`;
  });
  mockState = {
    vault: {
      activeNetwork: { chainId: 57057, explorer: 'https://synthetic.example/' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'33'.repeat(20)}` } } },
      accountAssets: { HDAccount: { 0: { ethereum: tokens } } },
    },
    price: { fiat: { asset: 'usd' } },
  };
  globalThis.fetch = jest.fn(async () => reply()) as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokenIconCache();
});

it('renders the current icon through the real asset details consumer', async () => {
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await waitFor(() =>
    expect(icon(view)).toHaveAttribute('src', tokens[0].logo)
  );
  expect(icon(view)).toHaveAttribute('alt', 'TOKEN11');
});

it('uses the cached next asset icon when the details consumer changes assets', async () => {
  const cached = render(<EvmAssetDetails id={tokens[1].id} />);
  await waitFor(() =>
    expect(icon(cached)).toHaveAttribute('src', tokens[1].logo)
  );
  cached.unmount();
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await waitFor(() =>
    expect(icon(view)).toHaveAttribute('src', tokens[0].logo)
  );
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  expect(icon(view)).toHaveAttribute('alt', 'TOKEN22');
  expect(icon(view)).toHaveAttribute('src', tokens[1].logo);
});

it.each([true, false])(
  'ignores an older icon request after changing the details asset, success=%s',
  async (success) => {
    const first = deferred();
    jest
      .mocked(fetch)
      .mockImplementation((url: any) =>
        url === tokens[0].logo ? first.promise : Promise.resolve(reply() as any)
      );
    const view = render(<EvmAssetDetails id={tokens[0].id} />);
    view.rerender(<EvmAssetDetails id={tokens[1].id} />);
    await waitFor(() =>
      expect(icon(view)).toHaveAttribute('src', tokens[1].logo)
    );
    await act(async () => first.resolve(reply(success)));
    expect(icon(view)).toHaveAttribute('alt', 'TOKEN22');
    expect(icon(view)).toHaveAttribute('src', tokens[1].logo);
  }
);

it('renders symbol fallback after failure and reuses the cached failure', async () => {
  jest.mocked(fetch).mockResolvedValue(reply(false) as any);
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await act(async () => void (await Promise.resolve()));
  expect(icon(view)).toBeNull();
  expect(screen.getByText('T', { exact: true })).toBeInTheDocument();
  view.unmount();
  render(<EvmAssetDetails id={tokens[0].id} />);
  expect(screen.getByText('T', { exact: true })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps a shared pending icon request alive when its first consumer unmounts', async () => {
  const pending = deferred();
  jest.mocked(fetch).mockReturnValue(pending.promise);
  const first = render(<TokenIcon logo={tokens[0].logo} symbol="FIRST" />);
  const second = render(<TokenIcon logo={tokens[0].logo} symbol="SECOND" />);
  expect(fetch).toHaveBeenCalledTimes(1);
  first.unmount();
  await act(async () => pending.resolve(reply()));
  expect(icon(second)).toHaveAttribute('src', tokens[0].logo);
  expect(icon(second)).toHaveAttribute('alt', 'SECOND');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not restore an old icon after switching to a symbol fallback', async () => {
  const pending = deferred();
  jest.mocked(fetch).mockReturnValue(pending.promise);
  const view = render(<TokenIcon logo={tokens[0].logo} symbol="FIRST" />);
  view.rerender(<TokenIcon symbol="SECOND" />);
  expect(screen.getByText('S', { exact: true })).toBeInTheDocument();
  await act(async () => pending.resolve(reply()));
  expect(icon(view)).toBeNull();
  expect(screen.getByText('S', { exact: true })).toBeInTheDocument();
});

it('keeps the ordinary FileReader image cache path working', async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['token'], { type: 'image/png' }),
  } as Response);
  const view = render(<TokenIcon logo={tokens[0].logo} symbol="SMALL" />);
  await waitFor(() =>
    expect(icon(view)).toHaveAttribute('src', 'data:image/png;base64,dG9rZW4=')
  );
});

it('uses the NFT fallback after an icon request fails', async () => {
  jest.mocked(fetch).mockResolvedValue(reply(false) as any);
  render(<TokenIcon logo={tokens[0].logo} symbol="NFT" isNft />);
  expect(await screen.findByTestId('nft-fallback')).toBeInTheDocument();
});
