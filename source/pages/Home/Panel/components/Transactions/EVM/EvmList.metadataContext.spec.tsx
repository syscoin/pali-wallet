/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { defaultAbiCoder, id } from 'utils/ethersV6Compat';

import { EvmTransactionsList } from './EvmList';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const RECIPIENT = `0x${'22'.repeat(20)}`;
const CONTRACT = `0x${'33'.repeat(20)}`;
const mockAlert = { success: jest.fn(), warning: jest.fn(), error: jest.fn() };
const mockTranslate = (key: string) => key;
const mockNavigate = jest.fn();
const mockFiat = () => '0 USD';
const mockIcons = () => null;
const mockType = () => 'Sent';
const mockFormatTime = () => 'Today';
const mockEnsCache = {};
let mockRows: any[];
let mockVault: any;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: mockVault }) },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({ vault: mockVault, vaultGlobal: { ensCache: mockEnsCache } }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => mockVault.accounts.HDAccount[0],
  selectActiveAccountRef: () => mockVault.activeAccount,
  selectActiveAccountAssets: () => mockVault.accountAssets.HDAccount[0],
  selectActiveAccountTransactions: () => ({
    ethereum: { [mockVault.activeNetwork.chainId]: mockRows },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({ getFiatAmount: mockFiat }),
}));
jest.mock('../../../../useHomeBrowsingState', () => ({
  getHomeBrowsingScope: () => 'metadata-test',
}));
jest.mock('../utils/useTransactionsInfos', () => ({
  useTransactionsListConfig: () => ({
    filteredTransactions: mockRows,
    formatTimeStamp: mockFormatTime,
    getTxStatusIcons: mockIcons,
    getTxType: mockType,
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
jest.mock('components/TokenIcon', () => ({
  TokenIcon: ({ logo, symbol, contractAddress }: any) => (
    <span
      data-testid="history-token-icon"
      data-logo={logo}
      data-symbol={symbol}
      data-contract={contractAddress}
    />
  ),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => (
    <span title={content}>{children}</span>
  ),
}));
jest.mock('components/TransactionOptions', () => ({
  TransactionOptions: () => null,
}));
jest.mock('utils/index', () => ({ getKnownTokenLogo: () => undefined }));

const token = (chainId: number) => ({
  id: `${CONTRACT}-${chainId}`,
  contractAddress: CONTRACT,
  chainId,
  tokenSymbol: `TOKEN${chainId}`,
  name: `Chain ${chainId} token`,
  logo: `https://icons.invalid/${chainId}.png`,
  decimals: 6,
  balance: 1,
  isNft: false,
});
let sequence = 0;
beforeEach(() => {
  mockVault = {
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { address: ACCOUNT } } },
    accountAssets: { HDAccount: { 0: { ethereum: [] } } },
    activeNetwork: { chainId: 1, currency: 'eth' },
  };
  mockRows = [
    {
      hash: `0x${(++sequence).toString(16).padStart(64, '0')}`,
      from: ACCOUNT,
      to: CONTRACT,
      value: '0',
      input:
        id('transfer(address,uint256)').slice(0, 10) +
        defaultAbiCoder
          .encode(['address', 'uint256'], [RECIPIENT, '1000000'])
          .slice(2),
      nonce: 1,
      chainId: 1,
      timestamp: 1791655200,
      blockNumber: 42,
      confirmations: 1,
    },
  ];
});

it.each([
  { chainId: 1, assets: [1] },
  { chainId: 1, assets: [137, 1] },
  { chainId: 137, assets: [1, 137] },
  { chainId: 1, assets: [1, 137] },
])(
  'uses chain $chainId metadata with stored asset order $assets',
  async ({ chainId, assets }) => {
    mockVault.activeNetwork.chainId = chainId;
    mockRows[0].chainId = chainId;
    mockVault.accountAssets.HDAccount[0].ethereum = assets.map(token);
    render(<EvmTransactionsList userTransactions={mockRows} />);
    await screen.findByText(`1 TOKEN${chainId}`);
    const icon = screen.getByTestId('history-token-icon');
    expect(icon.getAttribute('data-symbol')).toBe(`TOKEN${chainId}`);
    expect(icon.getAttribute('data-logo')).toBe(
      `https://icons.invalid/${chainId}.png`
    );
    expect(icon.parentElement?.parentElement?.getAttribute('title')).toBe(
      `Chain ${chainId} token`
    );
  }
);

it('refreshes a same-chain tooltip when only the imported token name changes', async () => {
  mockVault.accountAssets.HDAccount[0].ethereum = [token(1)];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('1 TOKEN1');
  const icon = screen.getByTestId('history-token-icon');
  expect(icon.parentElement?.parentElement?.getAttribute('title')).toBe(
    'Chain 1 token'
  );
  mockVault.accountAssets.HDAccount[0].ethereum = [
    { ...token(1), name: 'Updated token name' },
  ];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  await waitFor(() =>
    expect(
      screen
        .getByTestId('history-token-icon')
        .parentElement?.parentElement?.getAttribute('title')
    ).toBe('Updated token name')
  );
});

const unscopedToken = (chainId: unknown) => ({
  ...token(1),
  id: 'unscoped-token',
  chainId,
  tokenSymbol: 'UNSCOPED',
  name: 'Unscoped token',
  logo: 'https://icons.invalid/unscoped.png',
});

const expectMetadata = (symbol: string, name: string, logo: string) => {
  const icon = screen.getByTestId('history-token-icon');
  expect(icon.getAttribute('data-symbol')).toBe(symbol);
  expect(icon.getAttribute('data-logo')).toBe(logo);
  expect(icon.parentElement?.parentElement?.getAttribute('title')).toBe(name);
};

it.each([undefined, null, 0, '', 137])(
  'does not use stored token metadata with nonmatching chainId %s',
  async (chainId) => {
    mockVault.accountAssets.HDAccount[0].ethereum = [unscopedToken(chainId)];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    // Missing token chainId is malformed, not evidence of a historical format.
    // Await the generic decoded result rather than its loading placeholder.
    await screen.findByText('0x3333...3333 Transfer');
    expect(screen.queryByTestId('history-token-icon')).toBeNull();
  }
);

it.each(
  [undefined, null, 0, '', 137].flatMap((chainId) =>
    [false, true].map((matchingLast) => ({ chainId, matchingLast }))
  )
)(
  'keeps matching-chain metadata with nonmatching $chainId, matching last=$matchingLast',
  async ({ chainId, matchingLast }) => {
    const assets = [token(1), unscopedToken(chainId)];
    mockVault.accountAssets.HDAccount[0].ethereum = matchingLast
      ? assets.reverse()
      : assets;
    render(<EvmTransactionsList userTransactions={mockRows} />);
    await screen.findByText('1 TOKEN1');
    expectMetadata('TOKEN1', 'Chain 1 token', 'https://icons.invalid/1.png');
  }
);
