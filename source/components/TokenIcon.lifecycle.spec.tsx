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
  sanitizeTokenLogo: (value: string) => value,
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
  logo: `https://icons.example/${index}.png`,
}));
const originalFetch = globalThis.fetch;
let caseId = 0;
const images = [
  {
    mime: 'image/png',
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
  },
  {
    mime: 'image/webp',
    base64:
      'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA',
  },
];
const dataUrl = (index: number) =>
  `data:${images[index].mime};base64,${images[index].base64}`;
const reply = (ok = true, index = 0): Response => {
  let sent = false;
  const cancel = async () => undefined;
  return {
    ok,
    headers: {
      get: (name: string) =>
        name === 'content-type' ? images[index].mime : null,
    },
    body: {
      cancel,
      getReader: () => ({
        cancel,
        read: async () => {
          if (sent) return { done: true };
          sent = true;
          return {
            done: false,
            value: Uint8Array.from(Buffer.from(images[index].base64, 'base64')),
          };
        },
      }),
    },
  } as unknown as Response;
};
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
    token.logo = `https://icons.example/${caseId}/${index}.png`;
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
  globalThis.fetch = jest.fn(async (url) =>
    reply(true, url === tokens[1].logo ? 1 : 0)
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokenIconCache();
});

it('renders the current icon through the real asset details consumer', async () => {
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await waitFor(() => expect(icon(view)).toHaveAttribute('src', dataUrl(0)));
  expect(icon(view)).toHaveAttribute('alt', 'TOKEN11');
});

it('uses the cached next asset icon when the details consumer changes assets', async () => {
  const cached = render(<EvmAssetDetails id={tokens[1].id} />);
  await waitFor(() => expect(icon(cached)).toHaveAttribute('src', dataUrl(1)));
  cached.unmount();
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await waitFor(() => expect(icon(view)).toHaveAttribute('src', dataUrl(0)));
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  expect(icon(view)).toHaveAttribute('alt', 'TOKEN22');
  expect(icon(view)).toHaveAttribute('src', dataUrl(1));
});

it.each([true, false])(
  'ignores an older icon request after changing the details asset, success=%s',
  async (success) => {
    const first = deferred();
    jest
      .mocked(fetch)
      .mockImplementation((url: any) =>
        url === tokens[0].logo ? first.promise : Promise.resolve(reply(true, 1))
      );
    const view = render(<EvmAssetDetails id={tokens[0].id} />);
    view.rerender(<EvmAssetDetails id={tokens[1].id} />);
    await waitFor(() => expect(icon(view)).toHaveAttribute('src', dataUrl(1)));
    await act(async () => first.resolve(reply(success)));
    expect(icon(view)).toHaveAttribute('alt', 'TOKEN22');
    expect(icon(view)).toHaveAttribute('src', dataUrl(1));
  }
);

it('renders symbol fallback after failure and reuses the cached failure', async () => {
  jest.mocked(fetch).mockResolvedValue(reply(false) as any);
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  expect(await screen.findByText('T', { exact: true })).toBeInTheDocument();
  expect(icon(view)).toBeNull();
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
  await waitFor(() => expect(icon(second)).toHaveAttribute('src', dataUrl(0)));
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
  jest.mocked(fetch).mockImplementation(async () => reply());
  const view = render(<TokenIcon logo={tokens[0].logo} symbol="SMALL" />);
  await waitFor(() => expect(icon(view)).toHaveAttribute('src', dataUrl(0)));
});

it('uses the NFT fallback after an icon request fails', async () => {
  jest.mocked(fetch).mockResolvedValue(reply(false) as any);
  render(<TokenIcon logo={tokens[0].logo} symbol="NFT" isNft />);
  expect(await screen.findByTestId('nft-fallback')).toBeInTheDocument();
});
