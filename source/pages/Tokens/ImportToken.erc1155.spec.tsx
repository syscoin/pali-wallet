/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';

import { ImportToken } from './ImportToken';

let mockLastImport: Promise<void> | undefined;
const mockPreviewUnmount = jest.fn();
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
            <output data-testid="token-balance">{asset.balance}</output>
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
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));
jest.mock('utils/navigationState', () => ({
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
  contract = CONTRACT
) => {
  const request = pending.get(`${contract}:${tokenId}`);
  expect(request).toBeDefined();
  await act(async () => {
    request!.resolve([
      { tokenId, balance, rawBalance: String(balance), verified: true },
    ]);
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
  expect(screen.queryByRole('button', { name: 'Import NFT' })).toBeNull();
  await changeId('0');
  expect(screen.queryByRole('button', { name: 'Import NFT' })).toBeNull();
  await complete('0', 0);
  fireEvent.click(screen.getByRole('button', { name: 'Import NFT' }));
  await act(async () => undefined);
  expect(emitter).toHaveBeenCalledWith(
    ['wallet', 'saveTokenInfo'],
    [expect.objectContaining({ tokenId: '0', balance: 0, rawBalance: '0' })]
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
    [expect.objectContaining({ tokenId: '2', balance: 2, rawBalance: '2' })]
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
    [expect.objectContaining({ tokenId: '0' })]
  );
});
