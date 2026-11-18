/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Replay has separate actual consent tests; isolate unrelated detail decoding here.

import { projectEvmActivityRow } from '../../../../../../wallet/evmActivityRow';

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
const mockT = (key: string, values?: { amount?: string }) =>
  ((
    {
      'privacy.activity.deposit': 'Privacy deposit',
      'privacy.activity.withdrawal': 'Privacy withdrawal',
      'privacy.poolAmount': `${values?.amount} ETH pool`,
      'send.confirmed': 'Confirmed',
      'send.pending': 'Pending',
      'transactions.unconfirmed': 'Unconfirmed',
      'send.failed': 'Failed',
      'transactions.replaced': 'Replaced',
      'transactions.replacementPending': 'Replacement pending',
      'transactions.cancellation': 'Cancellation',
      'transactions.smartAuthorizations.operationHash': 'Operation hash',
      'header.speedUp': 'Speed Up',
      'send.sent': 'Sent',
      'notifications.clickToView': 'Details',
    } as Record<string, string>
  )[key] || key);

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: { HDAccount: { 0: { address: ACCOUNT, id: 0 } } },
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
  useHistoryBrowsingState: (_scope: string, initialHasMore?: boolean) => {
    const react = jest.requireActual('react');
    const [extraTransactions, setExtraTransactions] = react.useState([]);
    const [visibleCount, setVisibleCount] = react.useState(50);
    const [nextPage, setNextPage] = react.useState(2);
    const [hasMoreServer, setHasMoreServer] = react.useState(initialHasMore);
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
  DetailArrowSvg: jest.requireActual('components/Icon/Icon').DetailArrowSvg,
  ArrowUpSvg: () => <span>outgoing icon</span>,
  ReceivedArrowSvg: () => <span>incoming icon</span>,
}));
jest.mock('@ant-design/icons', () => ({}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/TransactionOptions', () => ({
  SmartAccountSignedOperationOptions: ({ operationHash }: any) => (
    <button type="button">Cancel instruction {operationHash}</button>
  ),
  TransactionOptions: ({ transaction: tx, canCancelSmart }: any) => (
    <div
      data-smart-cancel={String(canCancelSmart)}
      data-cancellation-unavailable={String(!!tx.cancellationUnavailable)}
    >
      Options:{tx.hash}
    </div>
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

it('changes the saved-only label when the same hash arrives in pending network history', async () => {
  const local = transaction('a', { historySource: 'local-signed' });
  mockRows = [local];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('Unconfirmed')).toBeTruthy();
  mockRows = [transaction('a', { historySource: 'explorer-txlist' })];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('Pending')).toBeTruthy();
  expect(screen.queryByText('Unconfirmed')).toBeNull();
});

it.each([
  // eslint-disable-next-line camelcase
  { result: { txreceipt_status: '0', isError: '1' }, success: false },
  { result: { success: false }, success: false },
  // eslint-disable-next-line camelcase
  { result: { txreceipt_status: '1', isError: '0' }, success: true },
])('only reports a successful settlement as successful: %p', async (test) => {
  const pending = transaction('7');
  mockRows = [pending];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('Pending')).toBeTruthy();
  expect(mockAlert.success).not.toHaveBeenCalled();
  mockRows = [
    { ...pending, blockNumber: 42, confirmations: 1, ...test.result },
  ];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(
    await screen.findByText(test.success ? 'Confirmed' : 'Failed')
  ).toBeTruthy();
  if (test.success)
    expect(mockAlert.success).toHaveBeenCalledWith(
      'send.txSuccessfull',
      { autoClose: 5000 },
      expect.any(Function)
    );
  else expect(mockAlert.success).not.toHaveBeenCalled();
});

it.each(['{Enter}', ' '])(
  'opens confirmed EVM details with the real keyboard action %s',
  async (key) => {
    const user = userEvent.setup();
    const confirmed = transaction('c', { blockNumber: 42, confirmations: 3 });
    mockRows = [confirmed];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    const action = await screen.findByRole('button', { name: 'Details' });
    action.focus();
    expect(document.activeElement).toBe(action);
    await user.keyboard(key);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/home/details',
      expect.objectContaining({
        state: expect.objectContaining({ hash: confirmed.hash }),
      })
    );
  }
);

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

it('recovers the truncated mixed first window before advancing to later explorer pages', async () => {
  const rows = ['1', '2', '3', '4'].map((digit, nonce) =>
    transaction(digit, { blockNumber: 42, confirmations: 3, nonce })
  );
  mockRows = [rows[0]];
  mockApiUrl = 'https://explorer.example/api';
  mockEmitter.mockImplementation(async (_method: string[], args: any[]) => ({
    transactions: args[3] === 1 ? rows.slice(0, 2) : [rows[args[3]]],
    hasMore: args[3] < 3,
  }));
  render(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByRole('button', { name: 'Details' });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(3)
  );
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(4)
  );
  expect(mockEmitter.mock.calls.map(([, args]) => args[3])).toEqual([1, 2, 3]);
  expect(mockRows).toEqual([rows[0]]);
});

it('keeps the same Load More position when the first explorer window cannot be recovered', async () => {
  const initial = transaction('1', {
    nonce: 1,
    blockNumber: 42,
    confirmations: 3,
  });
  const recovered = transaction('2', {
    nonce: 2,
    blockNumber: 41,
    confirmations: 4,
  });
  mockRows = [initial];
  mockApiUrl = 'https://explorer.example/api';
  let failFirstWindow = true;
  mockEmitter.mockImplementation(async (_method: string[], args: any[]) =>
    args[3] === 1 && failFirstWindow
      ? { error: 'First history window unavailable', transactions: null }
      : { transactions: [recovered], hasMore: false }
  );
  render(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByRole('button', { name: 'Details' });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await waitFor(() =>
    expect(mockAlert.warning).toHaveBeenCalledWith(
      'First history window unavailable'
    )
  );
  expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(1);
  failFirstWindow = false;
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(2)
  );
  expect(mockEmitter.mock.calls.map(([, args]) => args[3])).toEqual([
    1, 2, 1, 2,
  ]);
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

it.each([
  { receipt: '1', error: '0', label: 'Confirmed' },
  { receipt: '0', error: '1', label: 'Failed' },
])(
  'promotes a saved local row from an older explorer page to $label without pending actions',
  async ({ receipt, error, label }) => {
    const exactValue = '9007199254740993000000001';
    const local = projectEvmActivityRow({
      hash: hash('d'),
      chainId: '1',
      from: ACCOUNT,
      to: TARGET,
      value: exactValue,
      nonce: 8,
      type: 2,
      createdAt: 1791655200000,
      gasLimit: '21000',
      feePerGas: '7',
      maximumFee: '147000',
      dataBytes: 0,
      selector: null,
      phase: 'submitted',
      operation: 'send',
    });
    expect(local.blockNumber).toBeUndefined();
    expect(local.confirmations).toBeUndefined();
    mockRows = [local];
    mockApiUrl = 'https://explorer.example/api';
    const observed = transaction('d', {
      hash: hash('d').toUpperCase(),
      value: exactValue,
      blockNumber: 42,
      blockHash: hash('b'),
      confirmations: 3,
      // eslint-disable-next-line camelcase
      txreceipt_status: receipt,
      isError: error,
      historySource: 'explorer-txlist',
      gas: '23000',
      gasUsed: '21000',
    });
    mockEmitter.mockImplementation(async (_method: string[], args: any[]) => ({
      transactions: args[3] === 2 ? [observed] : [],
      hasMore: false,
    }));
    render(<EvmTransactionsList userTransactions={mockRows} />);
    expect(await screen.findByText('Unconfirmed')).toBeTruthy();
    expect(screen.queryByText(`Options:${local.hash}`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('/home/details', {
      state: expect.objectContaining({ hash: local.hash, tx: local }),
    });
    const loadMore = screen.getByRole('button', { name: 'buttons.loadMore' });
    fireEvent.click(loadMore);
    fireEvent.click(loadMore);
    await waitFor(() => {
      expect(screen.queryByText('Unconfirmed')).toBeNull();
      expect(screen.getByText(label)).toBeTruthy();
    });
    expect(mockEmitter.mock.calls.map(([, args]) => args[3])).toEqual([1, 2]);
    expect(screen.queryByText(`Options:${local.hash}`)).toBeNull();
    expect(screen.queryByText(`Options:${observed.hash}`)).toBeNull();
    expect(await screen.findAllByText(`${exactValue} ETH`)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('/home/details', {
      state: expect.objectContaining({ hash: observed.hash, tx: observed }),
    });
    expect(local.value).toBe(exactValue);
    expect(local.blockNumber).toBeUndefined();
    expect(local.confirmations).toBeUndefined();
  }
);

const confirmedRows = (count: number) =>
  Array.from({ length: count }, (_value, index) =>
    transaction('1', {
      hash: `0x${(index + 100).toString(16).padStart(64, '0')}`,
      nonce: index,
      timestamp: 1791655200 - index,
      blockNumber: index + 100,
      confirmations: 1,
      // eslint-disable-next-line camelcase
      txreceipt_status: '1',
    })
  );

it('only offers another explorer page when the initial read found more history', () => {
  mockApiUrl = 'https://explorer.example/api';
  mockRows = confirmedRows(1);
  const view = render(
    <EvmTransactionsList userTransactions={mockRows} explorerHasMore={false} />
  );
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();

  view.rerender(
    <EvmTransactionsList userTransactions={mockRows} explorerHasMore />
  );
  expect(screen.getByRole('button', { name: 'buttons.loadMore' })).toBeTruthy();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each([false, true])(
  'advances a duplicate-only local page while revealing cached rows (explorer=%s)',
  async (explorer) => {
    mockApiUrl = explorer ? 'https://explorer.example/api' : undefined;
    mockRows = confirmedRows(51);
    const loadMore = jest.fn();
    const Harness = () => {
      const [hasMore, setHasMore] = React.useState(true);
      loadMore.mockImplementation(async () => setHasMore(false));
      return (
        <EvmTransactionsList
          userTransactions={mockRows}
          olderRows={{ hasMore, loading: false, loadMore }}
        />
      );
    };
    render(<Harness />);
    expect(screen.getAllByText('Confirmed')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
    await waitFor(() => {
      expect(loadMore).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('Confirmed')).toHaveLength(51);
    });
    if (explorer)
      // The separate explorer page is still unknown, so its control remains.
      expect(
        screen.getByRole('button', { name: 'buttons.loadMore' })
      ).toBeTruthy();
    else
      expect(
        screen.queryByRole('button', { name: 'buttons.loadMore' })
      ).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('keeps unseen local pages available beyond the cached public window', async () => {
  mockRows = confirmedRows(51);
  const loadMore = jest.fn();
  const Harness = () => {
    const [rows, setRows] = React.useState(mockRows);
    const [page, setPage] = React.useState(0);
    loadMore.mockImplementation(async () => {
      setRows(confirmedRows(page === 0 ? 52 : 53));
      setPage(page + 1);
    });
    return (
      <EvmTransactionsList
        userTransactions={rows}
        olderRows={{ hasMore: page < 2, loading: false, loadMore }}
      />
    );
  };
  render(<Harness />);
  expect(screen.getAllByText('Confirmed')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await waitFor(() =>
    expect(screen.getAllByText('Confirmed')).toHaveLength(52)
  );
  expect(screen.getByRole('button', { name: 'buttons.loadMore' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await waitFor(() =>
    expect(screen.getAllByText('Confirmed')).toHaveLength(53)
  );
  expect(loadMore).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps incoming pending transactions details-only and preserves outgoing controls', async () => {
  const incoming = transaction('a', { from: TARGET, to: ACCOUNT });
  const outgoing = transaction('b', { from: ACCOUNT.toUpperCase() });
  mockRows = [incoming, outgoing];
  render(<EvmTransactionsList userTransactions={mockRows} />);

  expect(await screen.findByText(`Options:${outgoing.hash}`)).toBeTruthy();
  expect(screen.queryByText(`Options:${incoming.hash}`)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(mockNavigate).toHaveBeenCalledWith('/home/details', {
    state: expect.objectContaining({ hash: incoming.hash }),
  });
});

it('offers the existing menu for a locally tracked payment eligible for Speed Up', () => {
  const local = transaction('a', {
    historySource: 'local-signed',
    speedUpAvailable: true,
  });
  mockRows = [local];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(screen.getByText('Unconfirmed')).toBeTruthy();
  expect(screen.getByText(`Options:${local.hash}`)).toBeTruthy();
});

it('uses one ordinary row and the existing menu for authenticated Smart Account transactions', () => {
  const saved = transaction('a', {
    historySource: 'local-signed',
    smartAccount: { account: ACCOUNT, operationCount: 1 },
  });
  const unrelated = transaction('b', { historySource: 'local-signed' });
  mockRows = [saved, unrelated];
  const view = render(
    <EvmTransactionsList
      userTransactions={mockRows}
      smartCancellationHashes={new Set([saved.hash])}
    />
  );
  expect(
    screen.getByText(`Options:${saved.hash}`).getAttribute('data-smart-cancel')
  ).toBe('true');
  expect(screen.queryByText(`Options:${unrelated.hash}`)).toBeNull();
  expect(
    view.container.querySelectorAll('[data-transaction-hash]')
  ).toHaveLength(2);
  expect(view.container.querySelectorAll('[data-operation-hash]')).toHaveLength(
    0
  );

  mockRows = [unrelated];
  view.rerender(
    <EvmTransactionsList
      userTransactions={mockRows}
      smartCancellationHashes={new Set([saved.hash])}
    />
  );
  expect(
    view.container.querySelectorAll('[data-transaction-hash]')
  ).toHaveLength(1);
  expect(view.container.querySelectorAll('[data-operation-hash]')).toHaveLength(
    0
  );
});

it('shows a signed operation without a transaction identity and replaces its row when the outer appears', () => {
  const operation = {
    account: ACCOUNT,
    chainId: '1',
    createdAt: Date.now(),
    operationHash: `0x${'e'.repeat(64)}`,
    status: 'unresolved' as const,
  };
  const view = render(
    <EvmTransactionsList
      userTransactions={[]}
      smartSignedOperations={[operation]}
    />
  );
  expect(
    screen.getByText('transactions.smartAuthorizations.signedOperation')
  ).toBeTruthy();
  expect(
    screen.getByText('transactions.smartAuthorizations.noTransactionRecorded')
  ).toBeTruthy();
  expect(
    screen.getByRole('button', {
      name: `Cancel instruction ${operation.operationHash}`,
    })
  ).toBeTruthy();
  expect(view.container.querySelector('[data-transaction-hash]')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();

  const outer = transaction('a', {
    historySource: 'local-signed',
    smartAccount: { account: ACCOUNT, operations: [operation] },
  });
  view.rerender(
    <EvmTransactionsList
      userTransactions={[outer]}
      smartSignedOperations={[operation]}
    />
  );
  expect(
    screen.queryByText('transactions.smartAuthorizations.signedOperation')
  ).toBeNull();
  expect(
    view.container.querySelectorAll('[data-transaction-hash]')
  ).toHaveLength(1);
});

it('distinguishes signed operations with the same status by hash and recorded time', () => {
  const operations = [
    {
      operationHash: hash('e'),
      createdAt: new Date('2026-10-10T12:30:00Z'),
      shortHash: '0xeeeeeeee…eeeeeeee',
    },
    {
      operationHash: `0x${'e'.repeat(56)}${'f'.repeat(8)}`,
      createdAt: new Date('2026-10-10T12:31:00Z'),
      shortHash: '0xeeeeeeee…ffffffff',
    },
  ];
  render(
    <EvmTransactionsList
      userTransactions={[]}
      smartSignedOperations={operations.map(({ operationHash, createdAt }) => ({
        account: ACCOUNT,
        chainId: '1',
        createdAt: createdAt.getTime(),
        operationHash,
        status: 'unresolved',
      }))}
    />
  );

  for (const { operationHash, createdAt, shortHash } of operations) {
    const row = screen.getByRole('group', {
      name: `Operation hash ${operationHash}`,
    });
    expect(within(row).getByText(shortHash)).toBeTruthy();
    expect(row.querySelector('time')?.dateTime).toBe(createdAt.toISOString());
    expect(row.querySelector('time')?.textContent).toBe(
      createdAt.toLocaleTimeString('en-US')
    );
    expect(
      within(row).getByRole('button', {
        name: `Cancel instruction ${operationHash}`,
      })
    ).toBeTruthy();
  }
});

it('uses the pending cancellation row for retries of the same Smart Account operation', () => {
  const operation = {
    account: ACCOUNT,
    chainId: '1',
    createdAt: Date.now(),
    operationHash: hash('e'),
    replacesOperationHash: hash('c'),
    status: 'unresolved' as const,
  };
  const outer = transaction('a', {
    historySource: 'explorer-pending',
    value: '0',
  });
  const targets = new Map([[outer.hash, operation.replacesOperationHash]]);
  const show = (rows: any[]) => (
    <EvmTransactionsList
      userTransactions={rows}
      pendingSmartCancellationTargets={targets}
      smartSignedOperations={[operation]}
    />
  );
  const fallback = 'transactions.smartAuthorizations.noTransactionRecorded';
  const view = render(show([outer]));
  expect(screen.getAllByText('Cancellation')).toHaveLength(1);
  expect(screen.queryByText(fallback)).toBeNull();

  view.rerender(show([transaction('b')]));
  expect(screen.getByText(fallback)).toBeTruthy();
  const cancellation = screen.getByRole('group', {
    name: `Operation hash ${operation.operationHash}`,
  });
  expect(
    within(cancellation).getByRole('button', {
      name: `Cancel instruction ${operation.replacesOperationHash}`,
    })
  ).toBeTruthy();

  view.rerender(
    show([{ ...outer, confirmations: 1, blockNumber: 7, isError: '1' }])
  );
  expect(screen.getByText('Failed')).toBeTruthy();
  expect(screen.getByText(fallback)).toBeTruthy();
});

it.each([
  {
    fields: { input: '0xb214faa5' + '00'.repeat(32) },
    label: 'Privacy deposit',
    status: 'Pending',
  },
  {
    fields: { input: undefined, data: '0x21a0adb6' + '00'.repeat(32) },
    label: 'Privacy withdrawal',
    status: 'Pending',
  },
  {
    fields: {
      input: '0x',
      historySource: 'local-signed',
      methodSelector: '0xb214faa5',
    },
    label: 'Privacy deposit',
    status: 'Unconfirmed',
  },
])(
  'identifies the pool action while preserving its settlement status',
  async ({ fields, label, status }) => {
    mockRows = [
      transaction('a', {
        to: '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc',
        ...fields,
      }),
    ];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByText('0.1 ETH pool')).toBeTruthy();
    expect(screen.getByText(status)).toBeTruthy();
    if (status === 'Pending')
      expect(
        screen
          .getByText(`Options:${mockRows[0].hash}`)
          .getAttribute('data-cancellation-unavailable')
      ).toBe(String(label === 'Privacy withdrawal'));
  }
);

it.each([
  { to: '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc', input: '0x' },
  { to: TARGET, input: '0xb214faa5' },
  { to: ACCOUNT, input: '0x', value: '0', isCancel: true },
])(
  'omits pool labels from ordinary transfers and cancellations',
  async (fields) => {
    mockRows = [transaction('a', fields)];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    expect(await screen.findByText('Pending')).toBeTruthy();
    expect(screen.queryByText('0.1 ETH pool')).toBeNull();
    expect(screen.queryByText(/Privacy (deposit|withdrawal)/)).toBeNull();
  }
);
