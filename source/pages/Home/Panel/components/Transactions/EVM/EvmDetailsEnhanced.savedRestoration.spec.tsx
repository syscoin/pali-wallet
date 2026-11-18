/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { projectEvmActivityRow } from '../../../../../../wallet/evmActivityRow';
import { DetailsView } from 'pages/Home/Panel/components/Details';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const OLD_BLOCK = `0x${'bb'.repeat(32)}`;
let mockScope = { account: 'account-a', network: 'network-a' };
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
let mockHistory: any[];
let mockLocation: any;
let mockHash: string;
const mockState = {
  account: { id: 0, address: ACCOUNT },
  vault: {
    isBitcoinBased: false,
    activeAccount: { type: 'SmartAccount', id: 0 },
    accounts: { Imported: {} },
    activeNetwork: {
      chainId: 57057,
      currency: 'tsys',
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
    ethereum: { 57057: mockHistory },
  }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
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
jest.mock('pages/Home/Panel/components/AssetDetails', () => ({
  AssetDetails: () => null,
}));
jest.mock('pages/Home/Panel/components/Nfts', () => ({
  NftsDetails: () => null,
}));
jest.mock(
  'pages/Home/Panel/components/Transactions/UTXO/SyscoinDetails',
  () => ({
    SyscoinTransactionDetails: () => null,
  })
);
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

const SAVED = {
  hash: '0xaf93895073517ec3807b21d66fb3881dab61859092398fb10c6495cdb8718aa4',
  chainId: '57057',
  from: '0x3333333333333333333333333333333333333333',
  to: '0x4444444444444444444444444444444444444444',
  value: '0',
  createdAt: 1700000000123,
  phase: 'attempted',
  type: 2,
  gasLimit: '30000',
  feePerGas: '1',
  maximumFee: '30000',
  dataBytes: 100,
  selector: '0x12345678',
  operation: 'send',
  nonce: 1,
  smartAccount: {
    account: ACCOUNT,
    operationHash: '0x' + '55'.repeat(32),
    operationNonce: '0',
    operationCount: 1,
    callData: '0x',
    executions: [{ target: TARGET, value: '10000000000000000', data: '0x' }],
  },
};

const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const saved = () => ({ ...SAVED, smartAccount: { ...SAVED.smartAccount } });
const savedReads = () =>
  mockEmitter.mock.calls.filter(
    (call: any[]) => call[0][1] === 'getSavedEvmTransaction'
  );
beforeEach(() => {
  jest.clearAllMocks();
  mockHistory = [];
  mockHash = SAVED.hash;
  mockScope = { account: 'account-a', network: 'network-a' };
  mockState.account.address = ACCOUNT;
  mockState.vault.activeNetwork.chainId = 57057;
  mockState.vault.activeNetwork.url = 'https://rpc.example';
  mockLocation = {
    key: 'hash-only',
    pathname: '/home/details',
    state: { hash: mockHash, walletScope: mockScope },
  };
  mockEmitter.mockImplementation(([, method]: string[]) => {
    if (method === 'getSavedEvmTransaction') return Promise.resolve(saved());
    if (method === 'getEvmTransactionFromProvider')
      return Promise.resolve(null);
    if (method === 'getEvmTransactionFromAPI') return Promise.resolve(null);
    throw new Error('Unexpected mutation/read: ' + method);
  });
});
it('retries a failed saved-only lookup after hash-only reopen without repeating healthy network reads', async () => {
  const held = deferred();
  let localAttempts = 0;
  mockEmitter.mockImplementation(([, method]: string[]) => {
    if (method === 'getSavedEvmTransaction')
      return ++localAttempts === 1 ? held.promise : Promise.resolve(saved());
    return Promise.resolve(null);
  });
  render(<DetailsView />);
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(
        ([path]) => path[1] === 'getEvmTransactionFromProvider'
      )
    ).toBe(true)
  );
  expect(
    screen.queryByText('transactions.transactionNotFoundOrPending')
  ).toBeNull();
  await act(async () =>
    held.reject(new Error('Saved history temporarily unavailable'))
  );
  const retry = await screen.findByRole('button', { name: 'receive.retry' });
  expect(screen.getByRole('alert').textContent).toBe(
    'transactions.detailsUnavailable'
  );
  fireEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByTestId('transaction-amount').textContent).toBe(
      '10000000000000000'
    )
  );
  expect(savedReads()).toHaveLength(2);
  expect(
    mockEmitter.mock.calls.filter(
      ([path]) => path[1] === 'getEvmTransactionFromProvider'
    )
  ).toHaveLength(1);
});

it('settles an absent watch-only transaction from the network without attempting a local record', async () => {
  const previous = mockState.vault.activeAccount.type;
  mockState.vault.activeAccount.type = 'Imported';
  try {
    render(<DetailsView />);
    expect(
      await screen.findByText('transactions.transactionNotFoundOrPending')
    ).toBeTruthy();
    expect(savedReads()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
  } finally {
    mockState.vault.activeAccount.type = previous;
  }
});

it('restores the saved-only Smart amount after hash-only reopen without duplicate reads or replay dispatch', async () => {
  mockLocation.state.tx = projectEvmActivityRow(saved() as any);
  const activityOpen = render(<DetailsView />);
  await waitFor(() =>
    expect(screen.getByTestId('transaction-amount').textContent).toBe(
      '10000000000000000'
    )
  );
  expect(
    screen.queryByRole('button', {
      name: /resend|transactions\.replay\.review/i,
    })
  ).toBeNull();
  expect(savedReads()).toHaveLength(1);
  activityOpen.unmount();
  mockLocation = {
    ...mockLocation,
    key: 'reopened',
    state: { hash: mockHash, walletScope: mockScope },
  };
  render(<DetailsView />);
  await waitFor(() =>
    expect(screen.getByTestId('transaction-amount').textContent).toBe(
      '10000000000000000'
    )
  );
  expect(
    screen.queryByRole('button', {
      name: /resend|transactions\.replay\.review/i,
    })
  ).toBeNull();
  expect(
    screen.queryByText('transactions.transactionNotFoundOrPending')
  ).toBeNull();
  expect(screen.getByTestId('transaction-status').textContent).toBe(
    'transactions.unconfirmed'
  );
  expect(savedReads()).toHaveLength(2);
  expect(
    mockEmitter.mock.calls.every((call: any[]) =>
      [
        'getSavedEvmTransaction',
        'getEvmTransactionFromProvider',
        'getEvmTransactionFromAPI',
      ].includes(call[0][1])
    )
  ).toBe(true);
});
it.each(['account', 'endpoint', 'chain', 'hash'])(
  'discards a late saved result after a %s switch',
  async (change) => {
    const old = deferred();
    mockEmitter.mockImplementation(([, method]: string[]) =>
      method === 'getSavedEvmTransaction' ? old.promise : Promise.resolve(null)
    );
    const view = render(<DetailsView />);
    await waitFor(() => expect(savedReads()).toHaveLength(1));
    mockEmitter.mockImplementation(() => Promise.resolve(null));
    if (change === 'account') {
      mockScope = { ...mockScope, account: 'account-b' };
      mockState.account.address = TARGET;
    } else if (change === 'hash') {
      mockLocation = {
        ...mockLocation,
        state: { ...mockLocation.state, hash: '0x' + '66'.repeat(32) },
      };
    } else {
      mockScope = { ...mockScope, network: 'network-b' };
      if (change === 'endpoint')
        mockState.vault.activeNetwork.url = 'https://other-rpc.example';
      else mockState.vault.activeNetwork.chainId = 1;
    }
    view.rerender(<DetailsView />);
    expect(screen.queryByTestId('transaction-amount')?.textContent).not.toBe(
      '10000000000000000'
    );
    await act(async () => old.resolve(saved()));
    await screen.findByText('transactions.transactionNotFoundOrPending');
    expect(screen.queryByTestId('transaction-amount')).toBeNull();
    expect(savedReads()).toHaveLength(2);
  }
);
it('hides a previously displayed saved summary immediately when changing account', async () => {
  const view = render(<DetailsView />);
  await waitFor(() =>
    expect(screen.getByTestId('transaction-amount').textContent).toBe(
      '10000000000000000'
    )
  );
  mockEmitter.mockImplementation(() => Promise.resolve(null));
  mockScope = { ...mockScope, account: 'account-b' };
  mockState.account.address = TARGET;
  view.rerender(<DetailsView />);
  expect(screen.queryByTestId('transaction-amount')?.textContent).not.toBe(
    '10000000000000000'
  );
  await screen.findByText('transactions.transactionNotFoundOrPending');
  expect(screen.queryByTestId('transaction-amount')).toBeNull();
});
it.each(['hash', 'chain'])(
  'does not display a saved response with the wrong %s',
  async (field) => {
    mockEmitter.mockImplementation(([, method]: string[]) =>
      method === 'getSavedEvmTransaction'
        ? Promise.resolve({
            ...saved(),
            ...(field === 'hash'
              ? { hash: '0x' + '77'.repeat(32) }
              : { chainId: '1' }),
          })
        : Promise.resolve(null)
    );
    render(<DetailsView />);
    expect(
      screen.queryByRole('button', {
        name: /resend|transactions\.replay\.review/i,
      })
    ).toBeNull();
    await screen.findByText('transactions.transactionNotFoundOrPending');
    expect(screen.queryByTestId('transaction-amount')).toBeNull();
  }
);
it('keeps a fresh mined provider result ahead of retained local intent', async () => {
  mockEmitter.mockImplementation(([, method]: string[]) => {
    if (method === 'getSavedEvmTransaction') return Promise.resolve(saved());
    return Promise.resolve({
      hash: SAVED.hash,
      chainId: 57057,
      from: ACCOUNT,
      to: TARGET,
      value: '9',
      input: '0x',
      nonce: 1,
      blockHash: OLD_BLOCK,
      blockNumber: 42,
      confirmations: 2,
      success: true,
    });
  });
  render(<DetailsView />);
  expect(
    screen.queryByRole('button', {
      name: /resend|transactions\.replay\.review/i,
    })
  ).toBeNull();
  await waitFor(() =>
    expect(screen.getByTestId('transaction-status').textContent).toBe(
      'send.confirmed'
    )
  );
  await waitFor(() =>
    expect(screen.getByTestId('transaction-amount').textContent).toBe('9')
  );
  expect(savedReads()).toHaveLength(1);
});
it('keeps an observed pending provider result ahead of the saved-only label', async () => {
  mockHash = '0x' + 'aa'.repeat(32);
  mockLocation.state.hash = mockHash;
  mockEmitter.mockImplementation(([, method]: string[]) => {
    if (method === 'getSavedEvmTransaction')
      return Promise.resolve({ ...saved(), hash: mockHash });
    return Promise.resolve({
      hash: mockHash,
      chainId: 57057,
      from: ACCOUNT,
      to: TARGET,
      value: '9',
      input: '0x',
      nonce: 1,
      blockHash: null,
      blockNumber: null,
      confirmations: 0,
    });
  });
  render(<DetailsView />);
  expect(
    screen.queryByRole('button', {
      name: /resend|transactions\.replay\.review/i,
    })
  ).toBeNull();
  await waitFor(() =>
    expect(screen.getByTestId('transaction-status').textContent).toBe(
      'send.pending'
    )
  );
  await waitFor(() =>
    expect(screen.getByTestId('transaction-amount').textContent).toBe('9')
  );
});
