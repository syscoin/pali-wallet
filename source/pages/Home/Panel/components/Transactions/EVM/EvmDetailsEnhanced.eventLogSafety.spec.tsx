/** @jest-environment jsdom */
import { retryableFetch } from '@sidhujag/sysweb3-network';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import WalletErrorBoundary from 'components/WalletErrorBoundary/WalletErrorBoundary';
import EvmTransactionsController from 'scripts/Background/controllers/transactions/evm';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
let mockState: any;
let mockHistory: any[];
const mockReads = jest.fn();

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('@sidhujag/sysweb3-network', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-network'),
  retryableFetch: jest.fn(),
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockReads }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: {},
  }),
  useTransactionsListConfig: () => ({
    getTxType: () => 'Sent',
    getTxStatusIcons: () => null,
    getTxStatus: () => 'Confirmed',
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: ACCOUNT,
    network: 'synthetic-gas-display',
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ id: 0, address: ACCOUNT }),
  selectActiveAccountTransactions: () => ({
    ethereum: { 5700: mockHistory },
  }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
  camelCaseToText: (value: string) =>
    value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase()),
}));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: () => null,
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: ({ displayInfo }: any) => (
    <div data-testid="header">
      {displayInfo?.formattedValue} {displayInfo?.displaySymbol}
    </div>
  ),
  TransactionDetailsList: ({ details }: any) => (
    <div>
      {details.map((item: any) => (
        <span key={item.label} data-testid={item.label}>
          {String(item.value)}
        </span>
      ))}
    </div>
  ),
  TransactionEventLogs: jest.requireActual(
    'components/TransactionDetails/TransactionEventLogs'
  ).TransactionEventLogs,
  DecodedTransactionParams: () => null,
}));

let sequence = 0;
const nextHash = () => `0x${(++sequence).toString(16).padStart(64, '0')}`;
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: {
      activeNetwork: {
        kind: 'ethereum',
        chainId: 5700,
        currency: 'eth',
        url: 'https://synthetic.invalid',
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: { HDAccount: { 0: { id: 0, address: ACCOUNT } } },
      accountAssets: { HDAccount: { 0: { ethereum: [] } } },
    },
  };
});
afterEach(cleanup);

const event = (
  address = TARGET,
  topics: unknown = [`0x${'11'.repeat(32)}`]
) => ({
  address,
  topics,
  data: '0x',
});
const OTHER = `0x${'55'.repeat(20)}`;

it.each([
  ['empty', [], 0, []],
  ['one valid event', [event()], 1, [TARGET]],
  ['null before and after a valid event', [null, event(), null], 1, [TARGET]],
  ['null only', [null], 0, []],
  [
    'two valid siblings around null',
    [event(), null, event(OTHER)],
    2,
    [TARGET, OTHER],
  ],
  ['malformed records', [null, {}, [], 17, 'bad', { address: {} }], 0, []],
  ['malformed optional topics', [event(TARGET, 'not-an-array')], 1, [TARGET]],
] as const)(
  'keeps actual explorer details available with %s',
  async (_label, logs, expectedCount, addresses) => {
    const hash = nextHash();
    const apiUrl = 'https://explorer.synthetic.invalid/api';
    mockState.vault.activeNetwork.apiUrl = apiUrl;
    const summary = {
      hash,
      from: ACCOUNT,
      to: TARGET,
      chainId: 5700,
      value: '1000000000000000000',
      input: '0x',
      blockNumber: 42,
      confirmations: 3,
    };
    const result = { ...summary, logs };
    const originalLogs = JSON.stringify(logs);
    jest.mocked(retryableFetch).mockResolvedValue({
      json: async () => ({ status: '1', result }),
    } as Response);
    const api = EvmTransactionsController();
    expect(await api.fetchTransactionDetailsFromAPI(hash, apiUrl)).toEqual(
      result
    );
    mockHistory = [summary];
    mockReads.mockImplementation(async ([, method], args) => {
      if (method === 'getEvmTransactionFromAPI')
        return api.fetchTransactionDetailsFromAPI(args[0], args[1]);
      throw new Error('Unexpected controller call ' + method);
    });
    const errors = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await act(async () => {
        render(
          <WalletErrorBoundary pathname="/home/details" navigate={jest.fn()}>
            <EvmTransactionDetailsEnhanced hash={hash} tx={summary as any} />
          </WalletErrorBoundary>
        );
      });
      expect(mockReads).toHaveBeenCalledWith(
        ['wallet', 'getEvmTransactionFromAPI'],
        [hash, apiUrl]
      );
      expect(screen.queryByText('Something went wrong')).toBeNull();
      expect(screen.getByTestId('header').textContent).toBe('1 ETH');
      expect(JSON.stringify(result.logs)).toBe(originalLogs);
      if (expectedCount) {
        const heading = screen.getByText(
          `transactions.eventLogs (${expectedCount})`
        );
        const rows =
          heading.parentElement!.querySelectorAll(':scope > div > div');
        expect(Array.from(rows, (row) => row.children[1].textContent)).toEqual(
          addresses.map(
            (address) =>
              `send.address: ${jest
                .requireActual('utils/format')
                .ellipsis(address, 6, 4)}`
          )
        );
      } else {
        expect(screen.queryByText(/transactions.eventLogs/)).toBeNull();
      }
      if (_label === 'malformed optional topics')
        expect(screen.queryByText(/transactions.topics/)).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  }
);
