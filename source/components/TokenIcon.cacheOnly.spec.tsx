/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { decodeAssetTransfer } from '../shared/assetTransfer';
import { createAssetTransferDisplay } from '../shared/assetTransferDisplay';
import { selectAssetTransferIcon } from 'pages/Send/assetTransferIcon';
import { ApprovalDetails } from 'pages/Send/components/ApprovalDetails';
import { AssetTransferSummary } from 'pages/Send/components/AssetTransferSummary';
import { KeyringAccountType } from 'types/network';
import { Interface } from 'utils/ethersV6Compat';
import * as tokenImages from 'utils/tokens';

import { clearTokenIconCache, preloadTokenIcons, TokenIcon } from './TokenIcon';

let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('components/Tooltip/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  NftFallbackSvg: () => <span data-testid="nft-fallback" />,
}));
jest.mock('components/AddressText', () => ({
  AddressText: ({ value }: { value: string }) => <span>{value}</span>,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const account = `0x${'11'.repeat(20)}`;
const contract = `0x${'22'.repeat(20)}`;
const recipient = `0x${'33'.repeat(20)}`;
const logo =
  'https://coin-images.coingecko.com/coins/images/1/small/token.png?123';
const identity = {
  kind: 'evm' as const,
  chainId: 1,
  contractAddress: contract,
};
const context = {
  account: { type: KeyringAccountType.HDAccount, id: 0, address: account },
  chainId: 1,
  rpcUrl: 'rpc-a',
  slip44: 60,
};
const transfer = createAssetTransferDisplay(
  decodeAssetTransfer(
    new Interface(['function transfer(address,uint256)']).encodeFunctionData(
      'transfer',
      [recipient, 42]
    ),
    contract
  )!
);
const originalFetch = globalThis.fetch;

beforeEach(() => {
  clearTokenIconCache();
  mockState = {
    vault: {
      activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
      isBitcoinBased: false,
      activeNetwork: { chainId: 1, url: 'rpc-a' },
      accounts: {
        HDAccount: { 0: { address: account }, 1: { address: recipient } },
      },
      accountAssets: {
        HDAccount: {
          0: {
            ethereum: [
              {
                chainId: 1,
                contractAddress: contract,
                logo,
                tokenSymbol: 'SPOOF',
              },
            ],
          },
        },
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  globalThis.fetch = jest.fn(async () => {
    throw new Error('No image request permitted');
  });
});
afterEach(() => {
  cleanup();
  clearTokenIconCache();
  globalThis.fetch = originalFetch;
});

async function cache(url = logo, mime = 'image/png') {
  const fetcher = jest.fn(
    async () =>
      ({
        ok: true,
        blob: async () => new Blob(['cached image'], { type: mime }),
      } as Response)
  );
  globalThis.fetch = fetcher;
  await preloadTokenIcons([url]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockClear();
  return fetcher;
}
const raster = (view: ReturnType<typeof render>) =>
  view.container.querySelector('img[src^="data:image/"]');

it.each([
  {
    kind: 'evm' as const,
    chainId: 57057,
    contractAddress: '0x6EBb170f69D886916D9ee9E585CE39E626CbC35d',
  },
  {
    kind: 'evm' as const,
    chainId: 57057,
    contractAddress: '0xd501e86b1fc5823403b2ba995e2b8b78179236a6',
    decimals: 6,
  },
  { kind: 'spt' as const, chainId: 57, assetGuid: '123456' },
  { kind: 'spt' as const, chainId: 5700, assetGuid: '123456' },
])(
  'renders bundled artwork only for its strict identity %j, without image requests',
  (exact) => {
    // Asset imports share Jest's file stub; preserve the actual identity policy
    // and give its successful local result a distinct URL for this render test.
    const actual = tokenImages.getKnownTokenLogo;
    const local = '/bundled-known-artwork.svg';
    const resolve = jest
      .spyOn(tokenImages, 'getKnownTokenLogo')
      .mockImplementation((symbol, address, guid, chain, decimals) =>
        actual(symbol, address, guid, chain, decimals) ? local : null
      );
    try {
      const view = render(
        <TokenIcon cacheOnly identity={exact} symbol="SPOOF" />
      );
      expect(view.container.querySelector('img')).toHaveAttribute('src', local);
      view.rerender(
        <TokenIcon
          cacheOnly
          identity={{ ...exact, chainId: 1 }}
          symbol="SPOOF"
          logo={local}
        />
      );
      expect(view.container.querySelector(`img[src="${local}"]`)).toBeNull();
      if (exact.kind === 'evm') {
        view.rerender(
          <TokenIcon
            cacheOnly
            identity={{ ...exact, contractAddress: contract }}
            symbol="zkSYS"
            logo={local}
          />
        );
        expect(view.container.querySelector(`img[src="${local}"]`)).toBeNull();
        view.rerender(
          <TokenIcon
            cacheOnly
            identity={{ ...exact, decimals: 0 }}
            symbol="USDC"
            logo={local}
          />
        );
        expect(view.container.querySelector(`img[src="${local}"]`)).toBeNull();
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
    }
  }
);

it('does not request images on a cold cache or derive branding from a symbol or address-only registry', () => {
  const view = render(
    <TokenIcon
      cacheOnly
      identity={{
        ...identity,
        chainId: 999,
        contractAddress: '0x6EBb170f69D886916D9ee9E585CE39E626CbC35d',
      }}
      logo={logo}
      symbol="zkSYS"
      contractAddress="0x6EBb170f69D886916D9ee9E585CE39E626CbC35d"
    />
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(raster(view)).toBeNull();
  expect(view.container.textContent).not.toContain('z');
});

it('reuses cached raster bytes without another fetch and retires failed resources', async () => {
  const fetcher = await cache();
  const view = render(<TokenIcon cacheOnly identity={identity} logo={logo} />);
  expect(raster(view)).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.error(raster(view)!);
  expect(raster(view)).toBeNull();
  view.unmount();
  const next = render(<TokenIcon cacheOnly identity={identity} logo={logo} />);
  expect(raster(next)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('joins an existing ordinary icon request without starting another fetch', async () => {
  let finish!: (value: Response) => void;
  globalThis.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const ordinary = render(<TokenIcon logo={logo} />);
  const review = render(
    <TokenIcon cacheOnly identity={identity} logo={logo} />
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(raster(review)).toBeNull();
  await act(async () =>
    finish({
      ok: true,
      blob: async () => new Blob(['icon'], { type: 'image/png' }),
    } as Response)
  );
  await waitFor(() => expect(raster(review)).not.toBeNull());
  expect(fetch).toHaveBeenCalledTimes(1);
  ordinary.unmount();
});

it.each(['unmount', 'scope'])(
  'retires a pending image subscription on %s',
  async (boundary) => {
    let finish!: (value: Response) => void;
    globalThis.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const ordinary = render(<TokenIcon logo={logo} />);
    const review = render(
      <TokenIcon cacheOnly identity={identity} logo={logo} />
    );
    if (boundary === 'unmount') review.unmount();
    else
      review.rerender(
        <TokenIcon cacheOnly identity={{ ...identity, chainId: 2 }} />
      );
    await act(async () =>
      finish({
        ok: true,
        blob: async () => new Blob(['icon'], { type: 'image/png' }),
      } as Response)
    );
    await waitFor(() => expect(raster(ordinary)).not.toBeNull());
    expect(raster(review)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it.each(['image/svg+xml', 'text/html'])(
  'does not render cached %s bytes in approval mode',
  async (mime) => {
    const fetcher = await cache(logo, mime);
    const view = render(
      <TokenIcon cacheOnly identity={identity} logo={logo} />
    );
    expect(raster(view)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it('ignores an untrusted saved URL even when another screen previously cached its raster bytes', async () => {
  const url = 'https://dapp.invalid/borrowed-token.png';
  const fetcher = await cache(url);
  const view = render(<TokenIcon cacheOnly identity={identity} logo={url} />);
  expect(raster(view)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not render a remote URL fallback cached by ordinary icon mode', async () => {
  const fetcher = jest.fn(
    async () =>
      ({
        ok: true,
        blob: async () => new Blob(['x'.repeat(262145)], { type: 'image/png' }),
      } as Response)
  );
  globalThis.fetch = fetcher;
  const ordinary = render(<TokenIcon logo={logo} />);
  await waitFor(() =>
    expect(ordinary.container.querySelector('img')).toHaveAttribute('src', logo)
  );
  fetcher.mockClear();
  ordinary.rerender(<TokenIcon cacheOnly identity={identity} logo={logo} />);
  expect(ordinary.container.querySelector(`img[src="${logo}"]`)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  ordinary.unmount();
  fetcher.mockClear();
  const review = render(
    <TokenIcon cacheOnly identity={identity} logo={logo} />
  );
  expect(review.container.querySelector(`img[src="${logo}"]`)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('only uses the approved owner, chain and contract saved icon and drops it on a context change', async () => {
  const fetcher = await cache();
  const view = render(
    <AssetTransferSummary transfer={transfer} context={context} />
  );
  expect(raster(view)).not.toBeNull();
  mockState.vault.activeAccount.id = 1;
  view.rerender(<AssetTransferSummary transfer={transfer} context={context} />);
  expect(raster(view)).toBeNull();
  mockState.vault.activeAccount.id = 0;
  view.rerender(<AssetTransferSummary transfer={transfer} context={context} />);
  expect(raster(view)).not.toBeNull();
  mockState.vault.accountAssets.HDAccount[0].ethereum[0].chainId = 2;
  view.rerender(<AssetTransferSummary transfer={transfer} context={context} />);
  expect(raster(view)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('reuses only the captured ERC20 approval icon without changing its authority or amount', async () => {
  const fetcher = await cache();
  const props = {
    approvalType: 'erc20-amount' as const,
    authority: recipient,
    authorityLabelKey: 'transactions.spender',
    formattedAmount: '42',
    isValid: true,
    method: 'approve',
    standardVerified: true,
    tokenContract: contract,
    tokenDecimals: 6,
    tokenSymbol: 'SPOOF',
  };
  const view = render(<ApprovalDetails {...props} context={context} />);
  expect(raster(view)).not.toBeNull();
  expect(view.container.textContent).toContain('42 SPOOF');
  expect(view.container.textContent).toContain('transactions.spender');
  view.rerender(
    <ApprovalDetails {...props} context={{ ...context, chainId: 2 }} />
  );
  expect(raster(view)).toBeNull();
  expect(view.container.textContent).toContain('42 SPOOF');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['contract', 'chain', 'account', 'rpc', 'untrusted-logo'])(
  'rejects %s mismatches despite matching token symbols',
  (boundary) => {
    const asset = mockState.vault.accountAssets.HDAccount[0].ethereum[0];
    if (boundary === 'contract') asset.contractAddress = recipient;
    if (boundary === 'chain') asset.chainId = 2;
    if (boundary === 'account') mockState.vault.activeAccount.id = 1;
    if (boundary === 'rpc') mockState.vault.activeNetwork.url = 'rpc-b';
    if (boundary === 'untrusted-logo')
      asset.logo = 'https://dapp.invalid/spoof.png';
    expect(
      selectAssetTransferIcon(mockState, context, transfer)
    ).toBeUndefined();
    const view = render(
      <AssetTransferSummary transfer={transfer} context={context} />
    );
    expect(raster(view)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  }
);

it('rejects conflicting saved logos and an NFT image from a different token ID', () => {
  const assets = mockState.vault.accountAssets.HDAccount[0].ethereum;
  assets.push({ ...assets[0], logo: logo.replace('/1/', '/2/') });
  expect(selectAssetTransferIcon(mockState, context, transfer)).toBeUndefined();
  assets.pop();
  assets[0].tokenId = '7';
  const nft = createAssetTransferDisplay(
    decodeAssetTransfer(
      new Interface([
        'function safeTransferFrom(address,address,uint256)',
      ]).encodeFunctionData('safeTransferFrom', [account, recipient, 8]),
      contract
    )!
  );
  expect(selectAssetTransferIcon(mockState, context, nft)).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});
