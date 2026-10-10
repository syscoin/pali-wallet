/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';
import { EvmTransactionsList } from './EvmList';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const transaction = (digit: string, fields: any = {}) => ({
  hash: hash(digit),
  from: ACCOUNT,
  to: TARGET,
  value: '7',
  input: '0x',
  nonce: 8,
  chainId: 1,
  type: 2,
  timestamp: 1791655200,
  blockNumber: null,
  confirmations: 0,
  ...fields,
});
let mockRows: any[];
let mockApiUrl: string | undefined;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { success: jest.fn(), warning: jest.fn(), error: jest.fn() };
const mockFiat = () => '0 USD';
const mockT = (key: string) =>
  ((
    {
      'send.confirmed': 'Confirmed',
      'send.pending': 'Pending',
      'send.failed': 'Failed',
      'transactions.replaced': 'Replaced',
      'transactions.replacementPending': 'Replacement pending',
      'transactions.cancellation': 'Cancellation',
      'header.speedUp': 'Speed Up',
      'send.sent': 'Sent',
    } as Record<string, string>
  )[key] || key);

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: { chainId: 1, currency: 'eth', apiUrl: mockApiUrl },
        isBitcoinBased: false,
      },
      vaultGlobal: { ensCache: {} },
    }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ address: ACCOUNT, id: 0 }),
  selectActiveAccountRef: () => ({ id: 0, type: 'HDAccount' }),
  selectActiveAccountAssets: () => ({ ethereum: [] }),
  selectActiveAccountTransactions: () => ({ ethereum: { 1: mockRows } }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({ getFiatAmount: mockFiat }),
}));
jest.mock('../../../../useHomeBrowsingState', () => ({
  getHomeBrowsingScope: () => 'scope',
}));
jest.mock('../useHistoryBrowsingState', () => ({
  useHistoryBrowsingState: () => {
    const react = jest.requireActual('react');
    const [extraTransactions, setExtraTransactions] = react.useState([]);
    const [visibleCount, setVisibleCount] = react.useState(50);
    const [nextPage, setNextPage] = react.useState(2);
    const [hasMoreServer, setHasMoreServer] = react.useState(
      Boolean(mockApiUrl)
    );
    return {
      extraTransactions,
      visibleCount,
      nextPage,
      hasMoreServer,
      isRestoringPages: false,
      setExtraTransactions,
      setVisibleCount,
      setNextPage,
      setHasMoreServer,
    };
  },
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn()],
  }),
  useTransactionsListConfig: () => ({
    getTxType: () => 'Sent',
    getTxStatusIcons: () => null,
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'account1',
    network: 'network1',
  }),
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: ({ txStatus }: any) => (
    <div data-testid="detail-header">Detail:{txStatus}</div>
  ),
  TransactionDetailsList: () => null,
  TransactionEventLogs: () => null,
  DecodedTransactionParams: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  DetailArrowSvg: ({ onClick }: any) => (
    <button onClick={onClick}>Details</button>
  ),
  ArrowUpSvg: () => <span>outgoing icon</span>,
  ReceivedArrowSvg: () => <span>incoming icon</span>,
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/TransactionOptions', () => ({
  TransactionOptions: ({ transaction: tx }: any) => (
    <div>Options:{tx.hash}</div>
  ),
}));
jest.mock('utils/index', () => ({
  getKnownTokenLogo: () => undefined,
  camelCaseToText: (value: string) => value,
}));
jest.mock('utils/transactions', () => ({
  getSmartAccountDisplayTransaction: (tx: any) => tx,
  getSmartAccountExecutionTransactions: () => [],
  getTransactionDisplayInfo: async (tx: any) => ({
    displayValue: tx.value,
    formattedValue: tx.value,
    displaySymbol: 'ETH',
    isErc20Transfer: false,
    actualRecipient: tx.to,
    isNft: false,
  }),
  handleUpdateTransaction: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [];
  mockApiUrl = undefined;
  mockEmitter.mockReset();
});

it('keeps a confirmed accelerated cancellation separate from the replaced original', async () => {
  const original = transaction('a', { isReplaced: true });
  const winner = transaction('b', {
    to: ACCOUNT,
    value: '0',
    blockNumber: 42,
    confirmations: 3,
    isCancel: true,
    isSpeedUp: true,
    replacesHash: original.hash,
  });
  mockRows = [original, winner];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('0 ETH');
  expect(screen.getByText('Replaced')).toBeTruthy();
  expect(screen.getByText('Cancellation')).toBeTruthy();
  expect(screen.getByText('Confirmed')).toBeTruthy();
  expect(screen.getByText('(Speed Up)')).toBeTruthy();
  expect(screen.queryByText('Pending')).toBeNull();
  expect(screen.getAllByText('outgoing icon')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
  expect(mockNavigate).toHaveBeenCalledWith('/home/details', {
    state: {
      id: null,
      hash: original.hash,
      tx: original,
      replacementWinnerHash: winner.hash,
      replacementWinner: {
        hash: winner.hash,
        from: ACCOUNT,
        chainId: 1,
        nonce: 8,
        type: 2,
        blockNumber: 42,
      },
    },
  });
});

it('keeps Load more replacement settlement when opening real details without adding the page to Redux', async () => {
  const original = transaction('6', { isReplaced: true });
  const winner = transaction('7', {
    blockNumber: 42,
    input: '0x12345678',
    value: 'private route payload',
    isCancel: true,
  });
  mockRows = [original];
  mockApiUrl = 'https://explorer.example/api';
  mockEmitter.mockImplementation(async (method: string[], args: any[]) => {
    if (method[1] === 'getEvmTransactionsPage')
      return { transactions: [winner], hasMore: false };
    if (
      method[1] === 'getEvmTransactionFromProvider' &&
      args[0] === winner.hash
    )
      return winner;
    if (method[1] === 'getEvmTransactionFromProvider') return original;
    return null;
  });
  const list = render(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('Replacement pending');
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await screen.findByText('Replaced');
  fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
  const route = mockNavigate.mock.calls[0][1].state;
  expect(route.replacementWinnerHash).toBe(winner.hash);
  expect(route.replacementWinner).toEqual({
    hash: winner.hash,
    from: ACCOUNT,
    chainId: 1,
    nonce: 8,
    type: 2,
    blockNumber: 42,
  });
  expect(mockRows).toEqual([original]);
  list.unmount();
  render(<EvmTransactionDetailsEnhanced {...route} />);
  await waitFor(() =>
    expect(screen.getByTestId('detail-header').textContent).toBe(
      'Detail:Replaced'
    )
  );
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getEvmTransactionFromProvider'],
      [winner.hash]
    )
  );
  expect(screen.getByTestId('detail-header').textContent).toBe(
    'Detail:Replaced'
  );
  expect(mockRows).toEqual([original]);
});

it('rerenders an unchanged original when another hash mines', async () => {
  const original = transaction('c', { isReplaced: true });
  mockRows = [original];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('Replacement pending');
  mockRows = [
    original,
    transaction('d', { blockNumber: 42, confirmations: 3 }),
  ];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('Replaced');
  expect(screen.queryByText('Replacement pending')).toBeNull();
});

it.each([{ isReplaced: true }, { status: 'replaced' }])(
  'keeps superseded attempt %j details-only while the replacement is pending',
  async (marker) => {
    const original = transaction('4', marker);
    const latest = transaction('5', {
      isSpeedUp: true,
      replacesHash: original.hash,
    });
    mockRows = [original, latest];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    await screen.findByText('Replacement pending');
    expect(screen.queryByText(`Options:${original.hash}`)).toBeNull();
    expect(screen.getByText(`Options:${latest.hash}`)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(mockNavigate).toHaveBeenCalledWith('/home/details', {
      state: { id: null, hash: original.hash, tx: original },
    });
  }
);

it('offers actions only on the latest pending hop after cancel and speedup', async () => {
  const original = transaction('3', { isReplaced: true });
  const cancel = transaction('2', {
    isCancel: true,
    isReplaced: true,
    replacesHash: original.hash,
  });
  const latest = transaction('1', {
    isCancel: true,
    isSpeedUp: true,
    replacesHash: cancel.hash,
  });
  mockRows = [original, cancel, latest];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  await waitFor(() =>
    expect(screen.getAllByText('Replacement pending')).toHaveLength(2)
  );
  expect(screen.queryByText(`Options:${original.hash}`)).toBeNull();
  expect(screen.queryByText(`Options:${cancel.hash}`)).toBeNull();
  expect(screen.getByText(`Options:${latest.hash}`)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(2);
});

it.each(['1', '0'])(
  'uses original receipt %s rather than a stale replacement marker',
  async (receipt) => {
    mockRows = [
      transaction(receipt, {
        isReplaced: true,
        blockNumber: 42,
        // eslint-disable-next-line camelcase
        txreceipt_status: receipt,
      }),
    ];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    await screen.findByText(receipt === '1' ? 'Confirmed' : 'Failed');
    expect(screen.queryByText('Replaced')).toBeNull();
    expect(screen.queryByText('Replacement pending')).toBeNull();
  }
);

it('does not infer cancellation intent from an unannotated mined self-transfer', async () => {
  mockRows = [transaction('e', { to: ACCOUNT, value: '0', blockNumber: 42 })];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('Confirmed');
  expect(screen.queryByText('Cancellation')).toBeNull();
  expect(screen.getByText('Sent')).toBeTruthy();
});

it('recovers a recorded legacy cancellation parent across another speedup', async () => {
  const cancel = transaction('f', { isCancel: true, isReplaced: true });
  mockRows = [
    cancel,
    transaction('9', {
      isSpeedUp: true,
      replacesHash: cancel.hash,
      to: ACCOUNT,
      value: '0',
      blockNumber: 42,
    }),
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  await waitFor(() =>
    expect(screen.getAllByText('Cancellation')).toHaveLength(2)
  );
  expect(screen.getByText('Confirmed')).toBeTruthy();
});

it.each([
  { type: undefined },
  { historySource: 'explorer-tokentx' },
  { type: '0x7f' },
  { from: TARGET },
  { nonce: 9 },
])(
  'does not let incomplete or incompatible provider data %j prove replacement',
  async (fields) => {
    const original = transaction('8', { isReplaced: true });
    mockRows = [original, transaction('7', { blockNumber: 42, ...fields })];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    await screen.findByText('Replacement pending');
    expect(screen.queryByText('Replaced')).toBeNull();
  }
);
