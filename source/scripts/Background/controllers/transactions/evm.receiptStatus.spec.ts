/* eslint-disable camelcase -- Explorer API fields use txreceipt_status. */
import { retryableFetch } from '@sidhujag/sysweb3-network';

import { EVM_TRANSACTION_HISTORY_SOURCE } from 'utils/evmNonce';

import EvmTransactionsController from './evm';

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      vault: {
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          HDAccount: {
            0: {
              balances: { ethereum: '1' },
              evmTxCountByChainId: { 5700: 1 },
            },
          },
        },
      },
    }),
    dispatch: jest.fn(),
  },
}));
jest.mock('state/vault', () => ({
  setActiveAccountProperty: (payload: any) => ({ type: 'account', payload }),
}));
jest.mock('@sidhujag/sysweb3-network', () => ({
  retryableFetch: jest.fn(),
  INetworkType: { Ethereum: 'ethereum' },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  CustomJsonRpcProvider: jest.fn(),
}));
jest.mock('./smartAccountHistory', () => ({
  fetchSmartAccountUserOpTransactions: jest.fn(),
}));
jest.mock('./utils', () => ({
  findUserTxsInProviderByBlocksRange: jest.fn(),
  validateAndManageUserTransactions: (transactions: any) => transactions,
}));
jest.mock('utils/tokenDiscovery', () => ({
  isRoutescanApiUrl: () => false,
  fetchRoutescan: jest.fn(),
}));

const ADDRESS = `0x${'11'.repeat(20)}`;
const RECIPIENT = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const HASH = `0x${'aa'.repeat(32)}`;
const CHAIN = 5700;
const response = (result: any[], ok = true) =>
  ({
    ok,
    status: ok ? 200 : 503,
    json: async () => ({ status: '1', message: 'OK', result }),
  } as Response);
const transaction = (fields: any = {}) => ({
  hash: HASH,
  from: ADDRESS,
  to: RECIPIENT,
  value: '1000000000000000000',
  blockNumber: '123',
  timeStamp: String(Math.floor(Date.now() / 1000)),
  confirmations: '1',
  nonce: '8',
  type: '0x2',
  r: '0xabc',
  s: '0xdef',
  v: '0x1',
  input: '0x',
  ...fields,
});
const variants: { fields: any; status: string | null }[] = [
  { fields: { txreceipt_status: '1', isError: '0' }, status: '1' },
  { fields: { txreceipt_status: '0', isError: '1' }, status: '0' },
  { fields: { txreceipt_status: 0, isError: '0' }, status: '0' },
  { fields: { txreceipt_status: 1, isError: '1' }, status: '1' },
  { fields: { txreceipt_status: '0x0', isError: true }, status: '0' },
  { fields: { txreceipt_status: '0x01', isError: false }, status: '1' },
  { fields: { isError: '0' }, status: '1' },
  { fields: { isError: 0 }, status: '1' },
  { fields: { isError: false }, status: '1' },
  { fields: { isError: '1' }, status: '0' },
  { fields: { isError: 1 }, status: '0' },
  { fields: { isError: true }, status: '0' },
  { fields: { txreceipt_status: 'unknown', isError: '0' }, status: '1' },
  { fields: {}, status: null },
  { fields: { txreceipt_status: null, isError: null }, status: null },
  { fields: { txreceipt_status: '', isError: '' }, status: null },
  { fields: { txreceipt_status: 'unknown', isError: 'unknown' }, status: null },
  { fields: { txreceipt_status: '0x1invalid', isError: 2 }, status: null },
];

describe.each([
  ['Blockscout initial history', 'https://blockscout.example/api', false],
  ['Etherscan paged history', 'https://api.etherscan.example/api', true],
] as const)('%s receipt normalization', (_name, apiUrl, paged) => {
  beforeEach(() => jest.clearAllMocks());

  const fetchRows = async () => {
    const controller = EvmTransactionsController();
    return paged
      ? controller.fetchTransactionsPageFromAPI(ADDRESS, CHAIN, apiUrl, 2)
      : controller.fetchTransactionsFromAPI(ADDRESS, CHAIN, apiUrl);
  };

  it.each(variants)(
    'maps explorer fields $fields to status $status',
    async ({ fields, status }) => {
      jest
        .mocked(retryableFetch)
        .mockImplementation(async (endpoint) =>
          response(
            new URL(String(endpoint)).searchParams.get('action') === 'txlist'
              ? [transaction(fields)]
              : []
          )
        );
      const result = await fetchRows();
      expect(result.error).toBeUndefined();
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions?.[0]).toMatchObject({
        txreceipt_status: status,
        isError: status === null ? null : status === '0' ? '1' : '0',
        historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
        nonce: 8,
        type: 2,
        r: '0xabc',
        s: '0xdef',
        v: 1,
      });
      expect(retryableFetch).toHaveBeenCalledTimes(2);
    }
  );

  it('normalizes token-only fallback while retaining token-event provenance and nonce fields', async () => {
    jest.mocked(retryableFetch).mockImplementation(async (endpoint) => {
      const token =
        new URL(String(endpoint)).searchParams.get('action') === 'tokentx';
      return response(
        token ? [transaction({ contractAddress: TOKEN, isError: '0' })] : [],
        token
      );
    });
    const result = await fetchRows();
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions?.[0]).toMatchObject({
      txreceipt_status: '1',
      isError: '0',
      to: TOKEN,
      tokenRecipient: RECIPIENT,
      historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
      nonce: 8,
      type: 2,
      r: '0xabc',
      s: '0xdef',
      v: 1,
    });
  });
});

it.each([
  { fields: { txreceipt_status: 0, isError: false }, status: '0' },
  { fields: { isError: false }, status: '1' },
])(
  'preserves pending provenance while normalizing $fields',
  async ({ fields, status }) => {
    jest.clearAllMocks();
    jest
      .mocked(retryableFetch)
      .mockImplementation(async (endpoint) =>
        response(
          new URL(String(endpoint)).searchParams.get('action') ===
            'pendingtxlist'
            ? [transaction(fields)]
            : []
        )
      );
    const result = await EvmTransactionsController().fetchTransactionsFromAPI(
      ADDRESS,
      CHAIN,
      'https://blockscout.example/api',
      true
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions?.[0]).toMatchObject({
      txreceipt_status: status,
      isError: status === '0' ? '1' : '0',
      blockNumber: null,
      confirmations: 0,
      historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerPending,
      nonce: 8,
      type: 2,
      r: '0xabc',
      s: '0xdef',
      v: 1,
    });
    expect(retryableFetch).toHaveBeenCalledTimes(3);
  }
);
