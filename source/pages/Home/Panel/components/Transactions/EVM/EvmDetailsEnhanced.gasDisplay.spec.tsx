/** @jest-environment jsdom */
import { retryableFetch } from '@sidhujag/sysweb3-network';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import MainController from 'scripts/Background/controllers/MainController';
import EvmTransactionsController from 'scripts/Background/controllers/transactions/evm';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const PRICE_LABELS = [
  'Gas Price',
  'Max Fee Per Gas',
  'Max Priority Fee Per Gas',
];
let mockState: any;
let mockHistory: any[];
let mockWallet: any;
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
  TransactionEventLogs: () => null,
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
  mockWallet = Object.create(MainController.prototype);
});
afterEach(cleanup);

const renderDetails = async (row: any) => {
  mockHistory = [row];
  render(<EvmTransactionDetailsEnhanced hash={row.hash} tx={row} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('1 ETH')
  );
};

const renderProviderTransaction = async (
  gasPrice: bigint,
  maxFee: bigint = gasPrice,
  priority: bigint = gasPrice
) => {
  const hash = nextHash();
  const provider = {
    getTransaction: jest.fn(async () => ({
      hash,
      from: ACCOUNT,
      to: TARGET,
      value: BigInt('1000000000000000000'),
      chainId: BigInt(5700),
      data: '0x',
      gasPrice,
      gasLimit: BigInt(21000),
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
      nonce: 1,
      type: 2,
    })),
    getTransactionReceipt: jest.fn(async () => ({
      blockNumber: 42,
      blockHash: `0x${'33'.repeat(32)}`,
      gasUsed: BigInt(21000),
      status: 1,
      effectiveGasPrice: gasPrice,
      logs: [],
    })),
    getBlockNumber: jest.fn(async () => 44),
    getBlock: jest.fn(async () => ({ timestamp: 1700000000 })),
  };
  Object.defineProperty(mockWallet, 'ethereumTransaction', {
    value: { web3Provider: provider },
    configurable: true,
  });
  const row = await mockWallet.getEvmTransactionFromProvider(hash);
  expect(row.gasPrice).toBe(gasPrice.toString());
  expect(row.maxFeePerGas).toBe(maxFee.toString());
  expect(row.maxPriorityFeePerGas).toBe(priority.toString());
  expect(row.value).toBe('1000000000000000000');
  mockReads.mockImplementation(
    async ([, method]: string[], [requestedHash]: string[]) => {
      if (method === 'getEvmTransactionFromProvider')
        return mockWallet.getEvmTransactionFromProvider(requestedHash);
      throw new Error(`Unexpected controller call: ${method}`);
    }
  );
  await renderDetails(row);
  expect(screen.getByTestId('Gas Limit').textContent).toBe('21,000');
  expect(screen.getByTestId('Gas Used').textContent).toBe('21,000');
};

it('retains ordinary fees and value through the actual provider normalizer', async () => {
  await renderProviderTransaction(
    BigInt('20000000000'),
    BigInt('30000000000'),
    BigInt('1000000000')
  );
  expect(screen.getByTestId('Gas Price').textContent).toBe('20.00 Gwei');
  expect(screen.getByTestId('Max Fee Per Gas').textContent).toBe('30.00 Gwei');
  expect(screen.getByTestId('Max Priority Fee Per Gas').textContent).toBe(
    '1.00 Gwei'
  );
});

it.each([
  ['1', '0.000000001 Gwei'],
  ['10000', '0.00001 Gwei'],
  ['4999999', '0.004999999 Gwei'],
  ['5000000', '0.01 Gwei'],
  ['0', '0.00 Gwei'],
])(
  'formats %s wei without turning a positive price into zero',
  async (wei, expected) => {
    await renderProviderTransaction(BigInt(wei));
    for (const label of PRICE_LABELS)
      expect(screen.getByTestId(label).textContent).toBe(expected);
  }
);

const renderExplorerTransaction = async (fields: any) => {
  const hash = nextHash();
  const apiUrl = 'https://explorer.synthetic.invalid/api';
  mockState.vault.activeNetwork.apiUrl = apiUrl;
  const result = {
    hash,
    chainId: 5700,
    from: ACCOUNT,
    to: TARGET,
    value: '1000000000000000000',
    input: '0x',
    ...fields,
  };
  jest.mocked(retryableFetch).mockResolvedValue({
    json: async () => ({ status: '1', result }),
  } as Response);
  const api = EvmTransactionsController();
  const row = await api.fetchTransactionDetailsFromAPI(hash, apiUrl);
  expect(row).toEqual(result);
  mockReads.mockImplementation(async ([, method], args) => {
    if (method === 'getEvmTransactionFromAPI')
      return api.fetchTransactionDetailsFromAPI(args[0], args[1]);
    throw new Error(`Unexpected controller call: ${method}`);
  });
  await renderDetails(row);
};

it('keeps malformed explorer price fields unavailable', async () => {
  await renderExplorerTransaction({
    gasPrice: 'not-a-price',
    maxFeePerGas: 'not-a-price',
    maxPriorityFeePerGas: 'not-a-price',
  });
  for (const label of PRICE_LABELS)
    expect(screen.getByTestId(label).textContent).toBe('N/A');
});

it('does not invent absent or null explorer price fields', async () => {
  await renderExplorerTransaction({ maxFeePerGas: null });
  for (const label of PRICE_LABELS)
    expect(screen.queryByTestId(label)).toBeNull();
});
