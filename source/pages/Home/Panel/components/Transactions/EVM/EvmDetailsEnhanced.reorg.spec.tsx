/** @jest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { DetailsView } from '../../Details';
import { defaultAbiCoder, hexConcat, id } from 'utils/ethersV6Compat';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from 'utils/smartAccount/contracts';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const OLD_BLOCK = `0x${'bb'.repeat(32)}`;
const NEW_BLOCK = `0x${'cc'.repeat(32)}`;
const mockScope = { account: 'account-a', network: 'network-a' };
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
let mockHistory: any[];
let mockLocation: any;
let mockHash: string;
let mockVisit = 0;
const mockState = {
  account: { id: 0, address: ACCOUNT },
  vault: {
    isBitcoinBased: false,
    activeNetwork: {
      chainId: 1,
      currency: 'eth',
      url: 'https://rpc.example',
      explorer: 'https://explorer.example/',
    },
  },
};

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.account,
  selectActiveAccountTransactions: () => ({
    ethereum: { 1: mockHistory },
  }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: (url: string) => url,
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: {} }),
  useTransactionsListConfig: () => ({
    getTxType: () => 'Sent',
    getTxStatusIcons: () => null,
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
  navigateBack: jest.fn(),
}));
jest.mock('utils/index', () => ({
  adjustUrl: (value: string) => value,
  camelCaseToText: (value: string) =>
    value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase()),
}));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: () => null,
}));
jest.mock('utils/transactions', () => {
  const actual = jest.requireActual('utils/transactions');
  return {
    getSmartAccountDisplayTransaction: actual.getSmartAccountDisplayTransaction,
    getSmartAccountExecutionTransactions:
      actual.getSmartAccountExecutionTransactions,
    getTransactionDisplayInfo: async (transaction: any) => ({
      displayValue: transaction.value,
      formattedValue: String(transaction.value),
      displaySymbol: 'ETH',
      actualRecipient: transaction.to,
      isErc20Transfer: false,
      isNft: false,
    }),
  };
});
jest.mock('../../AssetDetails', () => ({ AssetDetails: () => null }));
jest.mock('../../Nfts', () => ({ NftsDetails: () => null }));
jest.mock('../UTXO/SyscoinDetails', () => ({
  SyscoinTransactionDetails: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  ExternalLinkSvg: () => null,
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: ({ txStatus, displayInfo }: any) => (
    <>
      <div data-testid="transaction-status">{txStatus}</div>
      <div data-testid="transaction-amount">
        {displayInfo?.formattedValue || '-'}
      </div>
    </>
  ),
  TransactionDetailsList: ({ details }: any) => (
    <dl>
      {details.map((detail: any, index: number) => (
        <div key={index}>
          <dt>{detail.label}</dt>
          <dd>{String(detail.value)}</dd>
        </div>
      ))}
    </dl>
  ),
  TransactionEventLogs: ({ logs }: any) => (
    <div data-testid="event-logs">
      {logs.map((log: any) => log.data).join(',')}
    </div>
  ),
  DecodedTransactionParams: () => null,
}));

const transaction = (changes: any = {}) => ({
  hash: mockHash,
  from: ACCOUNT,
  to: TARGET,
  chainId: 1,
  type: 2,
  nonce: 5,
  value: '7',
  input: '0x',
  blockNumber: 100,
  blockHash: OLD_BLOCK,
  confirmations: 3,
  timestamp: 1792281600,
  ...changes,
});
const detailValue = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset();
  mockHash = `0x${(++mockVisit).toString(16).padStart(64, '0')}`;
  mockHistory = [transaction()];
  mockLocation = {
    pathname: '/home/details',
    state: { hash: mockHash, walletScope: mockScope, tx: transaction() },
  };
  mockEmitter.mockResolvedValue(transaction({ gasUsed: '21000' }));
});

it('shows the current reorg block from live history when reopening cached EVM details', async () => {
  const firstVisit = render(<DetailsView />);
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
  expect(detailValue('Block Number')).toBe('100');
  expect(detailValue('Confirmations')).toBe('3');
  firstVisit.unmount();

  // The history merge accepts a newly observed canonical block even though
  // its later height means fewer confirmations. The route snapshot stays old.
  mockHistory = [
    transaction({
      blockNumber: 102,
      blockHash: NEW_BLOCK,
      confirmations: 1,
      timestamp: 1792281612,
    }),
  ];
  render(<DetailsView />);
  await waitFor(() => expect(detailValue('Block Number')).toBe('102'));
  expect(detailValue('Confirmations')).toBe('1');
  expect(detailValue('Block Hash')).toBe(NEW_BLOCK);
  expect(screen.getByTestId('transaction-status').textContent).toBe(
    'send.confirmed'
  );
  expect(screen.queryByText('Gas Used', { selector: 'dt' })).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('does not demote a cached mined receipt to an old pending navigation snapshot without live history', async () => {
  mockHistory = [];
  mockLocation.state.tx = transaction({
    blockNumber: null,
    blockHash: null,
    confirmations: 0,
  });
  const firstVisit = render(<DetailsView />);
  await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
  expect(detailValue('Block Number')).toBe('100');
  firstVisit.unmount();

  render(<DetailsView />);
  await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
  expect(detailValue('Block Number')).toBe('100');
  expect(detailValue('Block Hash')).toBe(OLD_BLOCK);
  expect(detailValue('Confirmations')).toBe('3');
  expect(screen.getByTestId('transaction-status').textContent).toBe(
    'send.confirmed'
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'keeps a cached mined receipt ahead of unchanged pending live history (cloned=%s)',
  async (cloned) => {
    const pending = transaction({
      blockNumber: null,
      blockHash: null,
      confirmations: 0,
    });
    mockHistory = [pending];
    mockLocation.state.tx = pending;
    const firstVisit = render(<DetailsView />);
    await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
    expect(detailValue('Block Number')).toBe('100');
    firstVisit.unmount();
    if (cloned)
      mockHistory = [
        {
          ...pending,
          blockNumber: '0x0',
          blockHash: '',
          confirmations: '0x0',
          timestamp: `0x${pending.timestamp.toString(16)}`,
        },
      ];

    render(<DetailsView />);
    await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
    expect(detailValue('Block Number')).toBe('100');
    expect(detailValue('Block Hash')).toBe(OLD_BLOCK);
    expect(detailValue('Confirmations')).toBe('3');
    expect(screen.getByTestId('transaction-status').textContent).toBe(
      'send.confirmed'
    );
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it('keeps a live reorg observed during a pending lookup ahead of that older lookup body', async () => {
  let resolve!: (value: any) => void;
  mockEmitter.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const view = render(<DetailsView />);
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  mockHistory = [
    transaction({
      blockNumber: 102,
      blockHash: NEW_BLOCK,
      confirmations: 1,
    }),
  ];
  await act(async () => view.rerender(<DetailsView />));
  expect(detailValue('Block Number')).toBe('102');
  await act(async () => resolve(transaction({ gasUsed: '21000' })));
  expect(screen.queryByText('Gas Used', { selector: 'dt' })).toBeNull();
  expect(detailValue('Block Number')).toBe('102');
  expect(detailValue('Block Hash')).toBe(NEW_BLOCK);
  expect(detailValue('Confirmations')).toBe('1');
});

it.each([null, 102])(
  'handles the first delayed live history at block %p while a hash-only provider lookup is pending',
  async (blockNumber) => {
    mockHistory = [];
    mockLocation.state.tx = undefined;
    let resolve!: (value: any) => void;
    mockEmitter.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const view = render(<DetailsView />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
    mockHistory = [
      transaction({
        blockNumber,
        blockHash: blockNumber ? NEW_BLOCK : null,
        confirmations: blockNumber ? 1 : 0,
      }),
    ];
    await act(async () => view.rerender(<DetailsView />));
    await act(async () => resolve(transaction({ gasUsed: '21000' })));
    expect(screen.getByTestId('transaction-status').textContent).toBe(
      'send.confirmed'
    );
    expect(detailValue('Block Number')).toBe(blockNumber ? '102' : '100');
    expect(detailValue('Block Hash')).toBe(blockNumber ? NEW_BLOCK : OLD_BLOCK);
    expect(detailValue('Confirmations')).toBe(blockNumber ? '1' : '3');
    if (blockNumber)
      expect(screen.queryByText('Gas Used', { selector: 'dt' })).toBeNull();
    else expect(detailValue('Gas Used')).toBe('21,000');
  }
);

it.each([
  { blockNumber: 102, blockHash: NEW_BLOCK, confirmations: 1 },
  { blockNumber: 100, blockHash: OLD_BLOCK, confirmations: 5 },
])(
  'keeps a fresh provider placement authoritative over the older route summary: %o',
  async (placement) => {
    mockHistory = [];
    mockEmitter.mockResolvedValue(
      transaction({ ...placement, gasUsed: '21000' })
    );
    render(<DetailsView />);
    await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
    expect(detailValue('Block Number')).toBe(String(placement.blockNumber));
    expect(detailValue('Block Hash')).toBe(placement.blockHash);
    expect(detailValue('Confirmations')).toBe(String(placement.confirmations));
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it('updates open EVM details when a later live summary moves to a block with fewer confirmations', async () => {
  const view = render(<DetailsView />);
  await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
  expect(detailValue('Block Number')).toBe('100');
  mockHistory = [
    transaction({
      blockNumber: 102,
      blockHash: NEW_BLOCK,
      confirmations: 1,
    }),
  ];
  await act(async () => view.rerender(<DetailsView />));
  expect(detailValue('Block Number')).toBe('102');
  expect(detailValue('Block Hash')).toBe(NEW_BLOCK);
  expect(detailValue('Confirmations')).toBe('1');
  expect(screen.queryByText('Gas Used', { selector: 'dt' })).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'does not reuse receipt logs, outcome or gas from a different block (current receipt supplied=%s)',
  async (supplied) => {
    mockEmitter.mockResolvedValue(
      transaction({
        gasLimit: '25000',
        gasUsed: '21000',
        cumulativeGasUsed: '99000',
        effectiveGasPrice: '1000000000',
        transactionIndex: 3,
        success: false,
        isError: '1',
        status: 'failed',
        // eslint-disable-next-line camelcase -- Explorer wire field.
        txreceipt_status: '0',
        revertReason: 'Old fork revert',
        logs: [{ data: 'old-receipt' }],
      })
    );
    const firstVisit = render(<DetailsView />);
    await waitFor(() => expect(detailValue('Gas Used')).toBe('21,000'));
    expect(screen.getByTestId('event-logs').textContent).toBe('old-receipt');
    firstVisit.unmount();
    mockHistory = [
      transaction({
        blockNumber: 102,
        blockHash: NEW_BLOCK,
        confirmations: 1,
        ...(supplied && {
          gasUsed: '22000',
          success: true,
          logs: [{ data: 'current-receipt' }],
        }),
      }),
    ];
    render(<DetailsView />);
    await waitFor(() => expect(detailValue('Block Number')).toBe('102'));
    expect(screen.getByTestId('event-logs').textContent).toBe(
      supplied ? 'current-receipt' : ''
    );
    if (supplied) {
      expect(detailValue('Gas Used')).toBe('22,000');
      expect(detailValue('Success')).toBe('Success');
    } else {
      expect(screen.queryByText('Gas Used', { selector: 'dt' })).toBeNull();
      expect(screen.queryByText('Success', { selector: 'dt' })).toBeNull();
    }
    expect(screen.queryByText('Revert Reason', { selector: 'dt' })).toBeNull();
    expect(detailValue('Gas Limit')).toBe('25,000');
    expect(detailValue('Nonce')).toBe('5');
    expect(screen.getByTestId('transaction-amount').textContent).toBe('7');
  }
);

it('does not let an old successful EntryPoint receipt override the current failed operation after a reorg', async () => {
  const zero = `0x${'00'.repeat(32)}`;
  const execution = hexConcat([
    TARGET,
    defaultAbiCoder.encode(['uint256'], ['7']),
    '0x',
  ]);
  const call =
    id('execute(bytes32,bytes)').slice(0, 10) +
    defaultAbiCoder.encode(['bytes32', 'bytes'], [zero, execution]).slice(2);
  const input = paliEntryPointInterface.encodeFunctionData('handleOps', [
    [[ACCOUNT, 0, '0x', call, zero, 50000, zero, '0x', '0x1234']],
    TARGET,
  ]);
  const original = transaction({
    from: TARGET,
    to: getPaliEntryPointAddress(1),
    input,
    smartAccountExecutionFrom: ACCOUNT,
    // eslint-disable-next-line camelcase -- Explorer wire field.
    txreceipt_status: '1',
  });
  const log = {
    ...paliEntryPointInterface.encodeEventLog(
      paliEntryPointInterface.getEvent('UserOperationEvent'),
      [zero, ACCOUNT, TARGET, 0, true, 1, 1]
    ),
    address: getPaliEntryPointAddress(1),
    transactionHash: mockHash,
  };
  mockHistory = [original];
  mockEmitter.mockResolvedValue({ ...original, logs: [log], success: true });
  const firstVisit = render(<DetailsView />);
  await waitFor(() =>
    expect(screen.getByTestId('event-logs').textContent).toBe(log.data)
  );
  await waitFor(() =>
    expect(screen.getByTestId('transaction-amount').textContent).toBe('7')
  );
  firstVisit.unmount();
  mockHistory = [
    {
      ...original,
      blockNumber: 102,
      blockHash: NEW_BLOCK,
      confirmations: 1,
      // eslint-disable-next-line camelcase -- Per-operation summary status.
      txreceipt_status: '0',
    },
  ];
  render(<DetailsView />);
  await waitFor(() => expect(detailValue('Block Number')).toBe('102'));
  expect(screen.getByTestId('transaction-status').textContent).toBe(
    'send.failed'
  );
  expect(screen.getByTestId('transaction-amount').textContent).toBe('-');
  expect(screen.getByTestId('event-logs').textContent).toBe('');
  expect(detailValue('Success')).toBe('Failed');
});
