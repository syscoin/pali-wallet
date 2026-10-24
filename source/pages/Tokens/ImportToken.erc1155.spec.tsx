/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';

import { ImportToken } from './ImportToken';

// Assert native hover information on the input while retaining the original
// glyph/content/color checks inside the decorative suffix.
const tokenIdTitleInput = () =>
  document.getElementById('custom-token-id') as HTMLInputElement;
const getTokenIdTitleGlyph = (title: string) => {
  const input = tokenIdTitleInput();
  expect(input).toHaveAttribute('title', title);
  return within(input.nextElementSibling as HTMLElement).getByTitle(title);
};

let mockLastImport: Promise<void> | undefined;
const mockPreviewUnmount = jest.fn();
const mockTranslate = jest.fn((key: string, values?: { balance?: unknown }) =>
  values?.balance === undefined ? key : `${key}:${values.balance}`
);
jest.mock('components/Icon/Icon', () => ({
  FiDownload: 'span',
  LoadingOutlined: 'span',
  CheckCircleOutlined: 'span',
  CloseCircleOutlined: 'span',
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: ({ assets, onImport, isLoading }: any) => {
    React.useEffect(() => () => mockPreviewUnmount(), []);
    return isLoading ? (
      <div data-testid="token-preview-loading">Verifying token ID</div>
    ) : (
      <div>
        {assets.map((asset: any) => (
          <div key={asset.id} data-testid="token-row" data-asset-id={asset.id}>
            <output data-testid="token-balance">
              {jest
                .requireActual('utils/format')
                .formatFullPrecisionBalance(asset.balance, asset.decimals)}
            </output>
            <button
              type="button"
              onClick={() => {
                mockLastImport = onImport(asset);
                void mockLastImport!.catch(() => undefined);
              }}
            >
              Import {asset.symbol}
            </button>
          </div>
        ))}
      </div>
    );
  },
}));
const mockAlert = { error: jest.fn(), success: jest.fn() };
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({ useController: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/tokens/add',
    search: '?tab=custom',
    hash: '',
    state: null,
    key: 'import',
  }),
  useSearchParams: () => [new URLSearchParams('tab=custom'), jest.fn()],
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'account', network: 'network' }),
  getCurrentTab: () => 'custom',
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));
jest.mock('./useTokenImportNavigation', () => ({
  useTokenImportNavigation: jest.fn(),
}));

const ADDRESS = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'33'.repeat(20)}`;
const OTHER_CONTRACT = `0x${'44'.repeat(20)}`;
const details = (contractAddress = CONTRACT) => ({
  contractAddress,
  tokenStandard: 'ERC-1155',
  isNft: true,
  name: 'Collection',
  symbol: 'NFT',
  decimals: 0,
  balance: 0,
  image: 'https://assets.invalid/nft.svg',
});
type Pending = {
  reject: (error: Error) => void;
  resolve: (value: any) => void;
};
let pending: Map<string, Pending>;
let emitter: jest.Mock;

const changeId = async (value: string) => {
  fireEvent.change(screen.getByLabelText('send.tokenId'), {
    target: { value },
  });
  await act(async () => undefined);
};
const complete = async (
  tokenId: string,
  balance: number,
  contract = CONTRACT,
  rawBalance = String(balance)
) => {
  const request = pending.get(`${contract}:${tokenId}`);
  expect(request).toBeDefined();
  await act(async () => {
    request!.resolve([{ tokenId, balance, rawBalance, verified: true }]);
  });
};
const load = async () => {
  const result = render(<ImportToken />);
  fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
    target: { value: CONTRACT },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  await screen.findByLabelText('send.tokenId');
  return result;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockLastImport = undefined;
  pending = new Map();
  emitter = jest.fn(([family, method], args) => {
    expect(family).toBe('wallet');
    if (method === 'getTokenDetailsWithMarketData')
      return Promise.resolve(details(args[0]));
    if (method === 'verifyERC1155Ownership')
      return new Promise((resolve, reject) => {
        pending.set(`${args[0]}:${args[2][0]}`, { resolve, reject });
      });
    if (method === 'saveTokenInfo') return Promise.resolve(true);
    if (method === 'getOnlyMarketData') return Promise.resolve(null);
    throw new Error(`Unexpected call ${method}`);
  });
  (useController as jest.Mock).mockReturnValue({ controllerEmitter: emitter });
  (useSelector as jest.Mock).mockImplementation((select) =>
    select({
      vault: {
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: { HDAccount: { 0: { address: ADDRESS } } },
        activeNetwork: { chainId: 1, url: 'https://rpc.invalid' },
        accountAssets: {},
      },
    })
  );
});
afterEach(() => jest.useRealTimers());

it('does not offer an ERC1155 import before its token ID has been verified', async () => {
  await load();
  expect(tokenIdTitleInput()).not.toHaveAttribute('title');
  expect(screen.queryByRole('button', { name: 'Import NFT' })).toBeNull();
  await changeId('0');
  expect(tokenIdTitleInput()).not.toHaveAttribute('title');
  expect(screen.queryByRole('button', { name: 'Import NFT' })).toBeNull();
  await complete('0', 0);
  expect(
    getTokenIdTitleGlyph('tokens.balanceForTokenId:0 tokens.verifyTokenExists')
  ).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
  await act(async () => undefined);
  expect(emitter).toHaveBeenCalledWith(
    ['wallet', 'saveTokenInfo'],
    [
      expect.objectContaining({ tokenId: '0', balance: 0, rawBalance: '0' }),
      expect.any(Object),
    ]
  );
});

it('keeps the preview loading region mounted while a changed token ID is unverified', async () => {
  await load();
  await changeId('1');
  await complete('1', 2);
  expect(screen.getByRole('button', { name: 'Import NFT' })).toBeDefined();
  mockPreviewUnmount.mockClear();
  await changeId('2');
  expect(screen.queryByRole('button', { name: 'Import NFT' })).toBeNull();
  expect(screen.getByTestId('token-preview-loading')).toBeDefined();
  expect(mockPreviewUnmount).not.toHaveBeenCalled();
});

it('does not let an old token ID result overwrite the current verified balance', async () => {
  await load();
  await changeId('1');
  await changeId('2');
  await complete('2', 2);
  expect(screen.getByTestId('token-balance').textContent).toBe('2');
  await complete('1', 99);
  expect(screen.getByTestId('token-balance').textContent).toBe('2');
  fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
  await act(async () => undefined);
  expect(emitter).toHaveBeenCalledWith(
    ['wallet', 'saveTokenInfo'],
    [
      expect.objectContaining({ tokenId: '2', balance: 2, rawBalance: '2' }),
      expect.any(Object),
    ]
  );
});

it('clears the verified balance immediately when the ID is edited or cleared', async () => {
  await load();
  await changeId('1');
  await complete('1', 99);
  expect(screen.getByTestId('token-balance').textContent).toBe('99');
  await changeId('2');
  expect(screen.queryByRole('button', { name: 'Import NFT' })).toBeNull();
  await changeId('');
  await complete('2', 2);
  expect(screen.queryByRole('button', { name: 'Import NFT' })).toBeNull();
});

it('ignores a balance result after changing the collection contract', async () => {
  await load();
  await changeId('1');
  fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
    target: { value: OTHER_CONTRACT },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  await changeId('2');
  await complete('2', 2, OTHER_CONTRACT);
  await complete('1', 99);
  expect(screen.getByTestId('token-balance').textContent).toBe('2');
});

it('does not save an import into a later screen after its logo request finishes', async () => {
  let finishLogo: (value: unknown) => void = () => undefined;
  const original = emitter.getMockImplementation()!;
  emitter.mockImplementation((path, args) => {
    if (path[1] === 'getTokenDetailsWithMarketData')
      return Promise.resolve({ ...details(args[0]), image: undefined });
    if (path[1] === 'getOnlyMarketData')
      return new Promise((resolve) => {
        finishLogo = resolve;
      });
    return original(path, args);
  });
  const view = await load();
  await changeId('1');
  await complete('1', 1);
  fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
  expect(
    emitter.mock.calls.some(([path]) => path[1] === 'getOnlyMarketData')
  ).toBe(true);
  view.unmount();
  await act(async () => finishLogo(null));
  expect(emitter.mock.calls.some(([path]) => path[1] === 'saveTokenInfo')).toBe(
    false
  );
});

it('keeps a failed import retryable and reports success only after a successful save', async () => {
  await load();
  await changeId('1');
  await complete('1', 1);
  const original = emitter.getMockImplementation()!;
  emitter.mockImplementation((path, args) =>
    path[1] === 'saveTokenInfo'
      ? Promise.reject(new Error('Synthetic save failure'))
      : original(path, args)
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
    await expect(mockLastImport).rejects.toThrow('Synthetic save failure');
  });
  expect(mockAlert.error).toHaveBeenCalledWith('Synthetic save failure');
  expect(mockAlert.success).not.toHaveBeenCalled();
  emitter.mockImplementation(original);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
    await mockLastImport;
  });
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
  expect(
    emitter.mock.calls.filter(([path]) => path[1] === 'saveTokenInfo')
  ).toHaveLength(2);
});

it('uses the same trimmed token ID for the preview identity and saved import', async () => {
  await load();
  await changeId(' 0 ');
  await complete('0', 0);
  expect(screen.getByTestId('token-row').getAttribute('data-asset-id')).toBe(
    `${CONTRACT}-1-0`
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
    await mockLastImport;
  });
  expect(emitter).toHaveBeenCalledWith(
    ['wallet', 'saveTokenInfo'],
    [expect.objectContaining({ tokenId: '0' }), expect.any(Object)]
  );
});

it.each([
  {
    quantity: '1000000000000000000000000000000',
    displayed: '1.00e30',
  },
  {
    quantity:
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    displayed: '1.16e77',
  },
])(
  'previews ERC1155 quantity $quantity rather than its capped numeric balance',
  async ({ quantity, displayed }) => {
    await load();
    await changeId('7');
    // The real ownership helper caps its legacy numeric balance but also returns
    // rawBalance specifically to retain quantities above Number.MAX_SAFE_INTEGER.
    await complete('7', Number.MAX_SAFE_INTEGER, CONTRACT, quantity);
    expect(screen.getByTestId('token-balance').textContent).toBe(displayed);
    expect(
      getTokenIdTitleGlyph(`tokens.balanceForTokenId:${quantity}`)
    ).toBeDefined();
    expect(mockTranslate).toHaveBeenCalledWith('tokens.balanceForTokenId', {
      balance: quantity,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
      await mockLastImport;
    });
    expect(emitter).toHaveBeenCalledWith(
      ['wallet', 'saveTokenInfo'],
      [
        expect.objectContaining({
          tokenId: '7',
          balance: Number.MAX_SAFE_INTEGER,
          rawBalance: quantity,
        }),
        expect.any(Object),
      ]
    );
  }
);

it('keeps the numeric preview and save compatible when ownership omits rawBalance', async () => {
  await load();
  await changeId('7');
  await act(async () =>
    pending
      .get(`${CONTRACT}:7`)!
      .resolve([{ tokenId: '7', balance: 3, verified: true }])
  );
  expect(screen.getByTestId('token-balance').textContent).toBe('3');
  expect(getTokenIdTitleGlyph('tokens.balanceForTokenId:3')).toBeDefined();
  expect(mockTranslate).toHaveBeenCalledWith('tokens.balanceForTokenId', {
    balance: 3,
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
    await mockLastImport;
  });
  const saved = emitter.mock.calls.find(
    ([path]) => path[1] === 'saveTokenInfo'
  )![1][0];
  expect(saved).toMatchObject({ tokenId: '7', balance: 3 });
  expect(saved).not.toHaveProperty('rawBalance');
});
