/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { defaultAbiCoder, id } from 'utils/ethersV6Compat';

import { EvmTransactionsList } from './EvmList';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const CONTRACT = `0x${'33'.repeat(20)}`;
const mockAlert = { success: jest.fn(), warning: jest.fn(), error: jest.fn() };
const mockVault = {
  activeAccount: { id: 0, type: 'HDAccount' },
  accounts: { HDAccount: { 0: { address: ACCOUNT } } },
  accountAssets: { HDAccount: { 0: { ethereum: [] } } },
  activeNetwork: { chainId: 1, currency: 'eth' },
};
let mockRows: any[] = [];
let mockFiatAvailable = true;
let mockFiatText = '0 USD';
const mockGetFiatAmount = () => mockFiatText;
beforeEach(() => {
  mockFiatAvailable = true;
  mockFiatText = '0 USD';
});
const mockEnsCache = {
  [TARGET]: { name: 'first.eth' },
  [ACCOUNT]: { name: 'updated.eth' },
};
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: mockVault }) },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({ vault: mockVault, vaultGlobal: { ensCache: mockEnsCache } }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ address: ACCOUNT }),
  selectActiveAccountRef: () => mockVault.activeAccount,
  selectActiveAccountAssets: () => ({ ethereum: [] }),
  selectActiveAccountTransactions: () => ({ ethereum: { 1: mockRows } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (((key: string) => key) as any)(copyKey, copyValues),
  }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: jest.fn() }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({
    getFiatAmount: mockGetFiatAmount,
    isFiatAvailable: mockFiatAvailable,
  }),
}));
jest.mock('../../../../useHomeBrowsingState', () => ({
  getHomeBrowsingScope: () => 'amount-test',
}));
jest.mock('../utils/useTransactionsInfos', () => ({
  useTransactionsListConfig: () => ({
    filteredTransactions: mockRows,
    formatTimeStamp: () => 'Today',
    getTxStatusIcons: () => null,
    getTxType: () => 'Sent',
    txId: 'hash',
  }),
}));
jest.mock('../useHistoryBrowsingState', () => ({
  useHistoryBrowsingState: () => ({
    extraTransactions: [],
    visibleCount: 50,
    nextPage: 2,
    hasMoreServer: false,
    isRestoringPages: false,
    setExtraTransactions: jest.fn(),
    setVisibleCount: jest.fn(),
    setNextPage: jest.fn(),
    setHasMoreServer: jest.fn(),
  }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('components/Icon/Icon', () => ({ DetailArrowSvg: () => null }));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TransactionOptions', () => ({
  TransactionOptions: () => null,
}));
jest.mock('utils/index', () => ({ getKnownTokenLogo: () => undefined }));

const erc1155Input = (tokenId: string, amount: string) =>
  id('safeTransferFrom(address,address,uint256,uint256,bytes)').slice(0, 10) +
  defaultAbiCoder
    .encode(
      ['address', 'address', 'uint256', 'uint256', 'bytes'],
      [ACCOUNT, TARGET, tokenId, amount, '0x']
    )
    .slice(2);
const erc721Input = (tokenId: string) =>
  id('safeTransferFrom(address,address,uint256)').slice(0, 10) +
  defaultAbiCoder
    .encode(['address', 'address', 'uint256'], [ACCOUNT, TARGET, tokenId])
    .slice(2);
const show = (input: string, hashDigit = 'a') => {
  mockRows = [
    {
      hash: `0x${hashDigit.repeat(64)}`,
      from: ACCOUNT,
      to: CONTRACT,
      value: '0',
      input,
      nonce: 1,
      chainId: 1,
      timestamp: 1791655200,
      blockNumber: 42,
      confirmations: 1,
    },
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
};

it.each(['0', '2'])(
  'shows ERC1155 quantity separately from token ID %s',
  async (tokenId) => {
    show(erc1155Input(tokenId, '2'));
    expect(await screen.findByText(`2 NFT #${tokenId}`)).toBeTruthy();
  }
);

it('preserves the exact ERC1155 quantity beyond Number precision', async () => {
  show(erc1155Input('5', '9007199254740993'), 'b');
  expect(await screen.findByText('9007199254740993 NFT #5')).toBeTruthy();
});

it('keeps an unknown ERC20 transferFrom generic instead of displaying its amount as an NFT id', async () => {
  show(
    id('transferFrom(address,address,uint256)').slice(0, 10) +
      defaultAbiCoder
        .encode(['address', 'address', 'uint256'], [ACCOUNT, TARGET, '1000000'])
        .slice(2),
    '8'
  );
  expect(await screen.findByText('0x3333...3333 Transfer')).toBeTruthy();
  expect(screen.queryByText('NFT #1000000')).toBeNull();
});

it.each(['1', '5'])(
  'shows ERC721 token ID %s without a quantity prefix',
  async (tokenId) => {
    show(erc721Input(tokenId), 'c');
    expect(await screen.findByText(`NFT #${tokenId}`)).toBeTruthy();
    expect(screen.queryByText(`1 NFT #${tokenId}`)).toBeNull();
  }
);

const tokenEvent = (tokenTransfer: any, hashDigit = 'd') => ({
  hash: `0x${hashDigit.repeat(64)}`,
  from: ACCOUNT,
  to: CONTRACT,
  value: '0',
  input: '0x',
  chainId: 1,
  timestamp: 1791655200,
  blockNumber: 42,
  confirmations: 1,
  historySource: 'explorer-tokentx',
  tokenTransfer: {
    chainId: 1,
    contractAddress: CONTRACT,
    recipient: TARGET,
    ...tokenTransfer,
  },
});

it('shows an event-only ERC1155 quantity without rounding it or mistaking it for the token id', async () => {
  mockRows = [
    tokenEvent({
      tokenStandard: 'ERC-1155',
      tokenId: '0',
      value: '9007199254740993',
      symbol: 'ART',
    }),
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('9007199254740993 ART #0')).toBeTruthy();
});

it('keeps an event-only ERC721 label free of a quantity prefix', async () => {
  mockRows = [
    tokenEvent({ tokenStandard: 'ERC-721', tokenId: '1', symbol: 'ART' }, 'e'),
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('ART #1')).toBeTruthy();
  expect(screen.queryByText('1 ART #1')).toBeNull();
});

it('refreshes cached event amounts and recipients when only the event payload changes', async () => {
  mockRows = [
    tokenEvent({ decimals: '6', value: '1000000', symbol: 'OLD' }, 'f'),
  ];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('1.0 OLD')).toBeTruthy();
  expect(screen.getByText('first.eth', { exact: false })).toBeTruthy();
  mockRows = [
    tokenEvent(
      { decimals: '6', value: '2000000', symbol: 'NEW', recipient: ACCOUNT },
      'f'
    ),
  ];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('2.0 NEW')).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByText('first.eth', { exact: false })).toBeNull()
  );
  expect(screen.getByText('updated.eth', { exact: false })).toBeTruthy();
});

it('refreshes a legacy token row when explicit event metadata arrives', async () => {
  const enriched = tokenEvent(
    { decimals: '6', value: '1000000', symbol: 'USDC' },
    '9'
  );
  mockRows = [
    { ...enriched, tokenRecipient: TARGET, tokenTransfer: undefined },
  ];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('0x3333...3333 Transfer')).toBeTruthy();
  mockRows = [enriched];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('1.0 USDC')).toBeTruthy();
});

it('updates only native fiat when quote availability changes without replacing the transaction row', async () => {
  mockFiatAvailable = false;
  mockRows = [
    {
      hash: '0x' + '7'.repeat(64),
      from: ACCOUNT,
      to: TARGET,
      value: '2000000000000000000',
      input: '0x',
      nonce: 1,
      chainId: 1,
      timestamp: 1791655200,
      blockNumber: 42,
      confirmations: 1,
    },
  ];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  await waitFor(() =>
    expect(view.container.textContent).toMatch(/2(?:\.0+)? ETH/)
  );
  expect(screen.getByText('---')).toBeTruthy();
  expect(screen.queryByText('0 USD')).toBeNull();
  const nativeText = view.container.textContent!.match(/2(?:\.0+)? ETH/)![0];
  mockFiatAvailable = true;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('0 USD')).toBeTruthy();
  mockFiatText = '4 USD';
  mockFiatAvailable = false;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('---');
  mockFiatAvailable = true;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('4 USD')).toBeTruthy();
  mockFiatText = '-4 USD';
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  // Keep the formatter reference stable: availability must itself invalidate memoization.
  mockFiatAvailable = false;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('---')).toBeTruthy();
  mockFiatAvailable = true;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('-4 USD')).toBeTruthy();
  expect(view.container.textContent).toContain(nativeText);
  expect(mockRows[0].value).toBe('2000000000000000000');
});
