/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

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
        activeNetwork: { chainId: 1, currency: 'eth' },
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
jest.mock('utils/index', () => ({ getKnownTokenLogo: () => undefined }));
jest.mock('utils/transactions', () => ({
  getSmartAccountDisplayTransaction: (tx: any) => tx,
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
    state: { id: null, hash: original.hash, tx: original },
  });
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
