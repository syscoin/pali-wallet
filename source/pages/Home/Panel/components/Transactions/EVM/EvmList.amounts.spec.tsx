/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
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
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: mockVault }) },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({ vault: mockVault, vaultGlobal: { ensCache: {} } }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ address: ACCOUNT }),
  selectActiveAccountRef: () => mockVault.activeAccount,
  selectActiveAccountAssets: () => ({ ethereum: [] }),
  selectActiveAccountTransactions: () => ({ ethereum: { 1: mockRows } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: jest.fn() }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({ getFiatAmount: () => '0 USD' }),
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

it.each(['1', '5'])(
  'shows ERC721 token ID %s without a quantity prefix',
  async (tokenId) => {
    show(erc721Input(tokenId), 'c');
    expect(await screen.findByText(`NFT #${tokenId}`)).toBeTruthy();
    expect(screen.queryByText(`1 NFT #${tokenId}`)).toBeNull();
  }
);
