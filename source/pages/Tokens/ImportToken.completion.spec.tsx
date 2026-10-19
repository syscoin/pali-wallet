/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AddToken } from './AddToken';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockState: any;
const mockTranslate = (key: string, values?: { symbol?: string }) =>
  key === 'tokens.importNamedToken' ? `Import ${values?.symbol} token` : key;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
    i18n: { language: 'en' },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('utils/index', () => ({
  truncate: (value: unknown) => String(value),
  ellipsis: (value: unknown) => String(value),
  formatFullPrecisionBalance:
    jest.requireActual('utils/format').formatFullPrecisionBalance,
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'account', network: 'network' }),
  getCurrentTab: (params: URLSearchParams, _state: unknown, fallback: string) =>
    params.get('tab') || fallback,
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));

const CONTRACT = `0x${'33'.repeat(20)}`;
const fixture = {
  id: `${CONTRACT}-1`,
  contractAddress: CONTRACT,
  chainId: 1,
  symbol: 'SAMPLE',
  name: 'Sample token',
  tokenStandard: 'ERC-20',
  isNft: false,
  decimals: 18,
  balance: 3,
  image: 'https://assets.invalid/sample.png',
};
const tree = (tab: string) => (
  <MemoryRouter initialEntries={[`/tokens/add?tab=${tab}`]}>
    <AddToken />
  </MemoryRouter>
);
const importButton = () =>
  screen.getByRole('button', {
    name: 'Import SAMPLE token',
  }) as HTMLButtonElement;
const publishAsset = () => {
  mockState.vault.accountAssets.HDAccount[0].ethereum = [
    { ...fixture, tokenSymbol: fixture.symbol },
  ];
};
const load = async (tab: string) => {
  const view = render(tree(tab));
  if (tab === 'custom') {
    fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
      target: { value: CONTRACT },
    });
    await act(async () => jest.advanceTimersByTimeAsync(500));
  } else {
    await act(async () => undefined);
  }
  expect(importButton().disabled).toBe(false);
  return view;
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'11'.repeat(20)}` } } },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        url: 'https://rpc.invalid',
        apiUrl: 'https://explorer.invalid/api',
      },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
    },
  };
  mockEmitter.mockReset().mockImplementation(([, method]) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve([fixture]);
    if (method === 'getTokenDetailsWithMarketData')
      return Promise.resolve(fixture);
    if (method === 'getOnlyMarketData') return Promise.resolve(null);
    if (method === 'saveTokenInfo') return Promise.resolve();
    throw new Error(`Unexpected ${method}`);
  });
});
afterEach(() => jest.useRealTimers());

it.each(['owned', 'custom'])(
  'keeps an acknowledged %s import disabled before the full-state broadcast arrives',
  async (tab) => {
    const view = await load(tab);
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mockEmitter.mockImplementation(([, method]) =>
      method === 'saveTokenInfo' ? saved : Promise.resolve(null)
    );
    fireEvent.click(importButton());
    expect(importButton().disabled).toBe(true);
    await act(async () => finish());
    expect(mockAlert.success).toHaveBeenCalledTimes(1);
    // Background asset writes use the 50 ms full-state broadcast; the method
    // ACK has no requirement to wait for delivery to this rendered popup.
    expect(importButton().disabled).toBe(true);
    fireEvent.click(importButton());
    expect(
      mockEmitter.mock.calls.filter(
        ([[, method]]) => method === 'saveTokenInfo'
      )
    ).toHaveLength(1);
    publishAsset();
    view.rerender(tree(tab));
    expect(importButton().disabled).toBe(true);
  }
);

it('retains the imported state when the background asset broadcast arrives before the ACK', async () => {
  const view = await load('custom');
  let finish!: () => void;
  mockEmitter.mockImplementation(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  fireEvent.click(importButton());
  publishAsset();
  view.rerender(tree('custom'));
  await act(async () => finish());
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
  expect(importButton().disabled).toBe(true);
});

it('keeps a failed import enabled so the same token can be retried', async () => {
  await load('custom');
  mockEmitter.mockRejectedValueOnce(new Error('Persistence failed'));
  const errors = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    await act(async () => fireEvent.click(importButton()));
    expect(mockAlert.error).toHaveBeenCalledWith('Persistence failed');
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(importButton().disabled).toBe(false);
    await act(async () => fireEvent.click(importButton()));
    expect(mockAlert.success).toHaveBeenCalledTimes(1);
  } finally {
    errors.mockRestore();
  }
});

it('keeps the custom tab and a different NFT contract independent from an imported owned token', async () => {
  await load('owned');
  await act(async () => fireEvent.click(importButton()));
  expect(importButton().disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'tokens.addCustomTab' }));
  expect(
    screen.queryByRole('button', { name: 'Import SAMPLE token' })
  ).toBeNull();
  const otherContract = `0x${'44'.repeat(20)}`;
  mockEmitter.mockImplementation(([, method]) => {
    if (method === 'getTokenDetailsWithMarketData')
      return Promise.resolve({
        ...fixture,
        contractAddress: otherContract,
        symbol: 'OTHER',
        tokenStandard: 'ERC-721',
        isNft: true,
        balance: 1,
      });
    return Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
    target: { value: otherContract },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  const other = screen.getByRole('button', {
    name: 'Import OTHER token',
  }) as HTMLButtonElement;
  expect(other.disabled).toBe(false);
  await act(async () => fireEvent.click(other));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'saveTokenInfo'],
    [
      expect.objectContaining({ contractAddress: otherContract, isNft: true }),
      expect.any(Object),
    ]
  );
});

it('does not carry a local imported marker to another account through AddToken', async () => {
  const view = await load('owned');
  await act(async () => fireEvent.click(importButton()));
  expect(importButton().disabled).toBe(true);
  mockState.vault.accounts.HDAccount[1] = { address: `0x${'55'.repeat(20)}` };
  mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
  mockState.vault.accountAssets.HDAccount[1] = { ethereum: [], syscoin: [] };
  view.rerender(tree('owned'));
  await act(async () => undefined);
  expect(importButton().disabled).toBe(false);
});

it('keeps distinct ERC1155 token IDs importable within the same mounted custom list', async () => {
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve([]);
    if (method === 'getTokenDetailsWithMarketData')
      return Promise.resolve({
        ...fixture,
        tokenStandard: 'ERC-1155',
        isNft: true,
      });
    if (method === 'verifyERC1155Ownership')
      return Promise.resolve([
        { tokenId: args[2][0], balance: 2, verified: true },
      ]);
    return Promise.resolve();
  });
  render(tree('custom'));
  fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
    target: { value: CONTRACT },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  fireEvent.change(screen.getByLabelText('send.tokenId'), {
    target: { value: '1' },
  });
  await act(async () => undefined);
  await act(async () => fireEvent.click(importButton()));
  expect(importButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('send.tokenId'), {
    target: { value: '2' },
  });
  await act(async () => undefined);
  expect(importButton().disabled).toBe(false);
  await act(async () => fireEvent.click(importButton()));
  const saved = mockEmitter.mock.calls
    .filter(([[, method]]) => method === 'saveTokenInfo')
    .map(([, [token]]) => token.tokenId);
  expect(saved).toEqual(['1', '2']);
});
