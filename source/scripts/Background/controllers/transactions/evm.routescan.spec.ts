import { retryableFetch } from '@sidhujag/sysweb3-network';

import { EVM_TRANSACTION_HISTORY_SOURCE } from 'utils/evmNonce';
import { fetchRoutescan } from 'utils/tokenDiscovery';

import EvmTransactionsController from './evm';

let mockVault: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({ vault: mockVault }),
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
jest.mock('./smartAccountHistory', () => ({
  fetchSmartAccountUserOpTransactions: jest.fn(),
}));
jest.mock('./utils', () => ({
  findUserTxsInProviderByBlocksRange: jest.fn(),
  validateAndManageUserTransactions: (transactions: any) => transactions,
}));
jest.mock('utils/tokenDiscovery', () => ({
  ...jest.requireActual('utils/tokenDiscovery'),
  fetchRoutescan: jest.fn(),
}));

const ROUTESCAN_API =
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const ADDRESS = `0x${'11'.repeat(20)}`;
const RECIPIENT = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const TX_HASH = `0x${'aa'.repeat(32)}`;
const TOKEN_TX_HASH = `0x${'bb'.repeat(32)}`;
const UNSUPPORTED = {
  status: '0',
  message: 'NOTOK',
  result: 'Error! Missing Or invalid Action name',
};
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data } as Response);
const transaction = (overrides = {}) => ({
  hash: TX_HASH,
  from: ADDRESS,
  to: RECIPIENT,
  value: '1000000000000000000',
  blockNumber: '22290001',
  timeStamp: String(Math.floor(Date.now() / 1000)),
  confirmations: '3',
  nonce: '5',
  type: '2',
  input: '0x',
  ...overrides,
});
const requestedUrls = () =>
  [
    ...jest.mocked(fetchRoutescan).mock.calls,
    ...jest.mocked(retryableFetch).mock.calls,
  ].map(([url]) => new URL(String(url)));

describe('Routescan Etherscan compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockVault = {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: {
          0: { balances: { ethereum: '1' }, evmTxCountByChainId: { 1: 1 } },
        },
      },
    };
  });
  afterEach(() => jest.restoreAllMocks());

  it('validates the API through proxy when the Blockscout action returns HTTP 200 NOTOK', async () => {
    jest
      .mocked(fetchRoutescan)
      .mockResolvedValueOnce(response(UNSUPPORTED))
      .mockResolvedValueOnce(
        response({ jsonrpc: '2.0', id: 1, result: '0x18f20dd' })
      );

    await expect(
      EvmTransactionsController().testExplorerApi(ROUTESCAN_API)
    ).resolves.toEqual({ success: true });

    expect(requestedUrls().map((url) => url.pathname)).toEqual([
      '/v2/network/mainnet/evm/1/etherscan/api',
      '/v2/network/mainnet/evm/1/etherscan/api',
    ]);
    expect(
      requestedUrls().map((url) => [
        url.searchParams.get('module'),
        url.searchParams.get('action'),
      ])
    ).toEqual([
      ['block', 'eth_block_number'],
      ['proxy', 'eth_blockNumber'],
    ]);
    expect(retryableFetch).not.toHaveBeenCalled();
  });

  it('does not retry an explicit API-key rejection with another action', async () => {
    jest.mocked(fetchRoutescan).mockResolvedValueOnce(
      response({
        status: '0',
        message: 'NOTOK',
        result: 'Missing API key',
      })
    );

    await expect(
      EvmTransactionsController().testExplorerApi(ROUTESCAN_API)
    ).resolves.toEqual({ success: false, error: 'settings.missingApiKey' });
    expect(fetchRoutescan).toHaveBeenCalledTimes(1);
    expect(retryableFetch).not.toHaveBeenCalled();
  });

  it('loads confirmed and token history without requesting unsupported pendingtxlist', async () => {
    jest.mocked(fetchRoutescan).mockImplementation(async (endpoint) => {
      const action = new URL(String(endpoint)).searchParams.get('action');
      return response({
        status: '1',
        message: 'OK',
        result:
          action === 'txlist'
            ? [transaction()]
            : [transaction({ hash: TOKEN_TX_HASH, contractAddress: TOKEN })],
      });
    });

    const result = await EvmTransactionsController().fetchTransactionsFromAPI(
      ADDRESS,
      1,
      ROUTESCAN_API,
      true
    );

    expect(result.error).toBeUndefined();
    expect(result.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hash: TX_HASH,
          chainId: 1,
          blockNumber: 22290001,
          nonce: 5,
        }),
        expect.objectContaining({
          hash: TOKEN_TX_HASH,
          to: TOKEN,
          tokenRecipient: RECIPIENT,
          historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
        }),
      ])
    );
    expect(
      requestedUrls().map((url) => url.searchParams.get('action'))
    ).toEqual(['txlist', 'tokentx']);
    for (const url of requestedUrls()) {
      expect(url.pathname).toBe('/v2/network/mainnet/evm/1/etherscan/api');
      expect(url.searchParams.get('address')).toBe(ADDRESS);
    }
    expect(fetchRoutescan).toHaveBeenCalledTimes(2);
    expect(retryableFetch).not.toHaveBeenCalled();
  });

  it('preserves pagination and recipient annotation through the compatible API', async () => {
    jest.mocked(fetchRoutescan).mockImplementation(async (endpoint) => {
      const action = new URL(String(endpoint)).searchParams.get('action');
      return response({
        status: '1',
        message: 'OK',
        result:
          action === 'txlist'
            ? [transaction(), transaction({ hash: TOKEN_TX_HASH })]
            : [transaction({ contractAddress: TOKEN })],
      });
    });

    const result =
      await EvmTransactionsController().fetchTransactionsPageFromAPI(
        ADDRESS,
        1,
        ROUTESCAN_API,
        2,
        2
      );

    expect(result).toMatchObject({
      hasMore: true,
      transactions: [
        { hash: TX_HASH, tokenRecipient: RECIPIENT },
        { hash: TOKEN_TX_HASH },
      ],
    });
    for (const url of requestedUrls()) {
      expect(url.pathname).toBe('/v2/network/mainnet/evm/1/etherscan/api');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('offset')).toBe('2');
    }
    expect(fetchRoutescan).toHaveBeenCalledTimes(2);
    expect(retryableFetch).not.toHaveBeenCalled();
  });

  it('retains pending discovery for custom Blockscout APIs', async () => {
    jest.mocked(retryableFetch).mockImplementation(async () =>
      response({
        status: '1',
        message: 'OK',
        result: [],
      })
    );

    await EvmTransactionsController().fetchTransactionsFromAPI(
      ADDRESS,
      1,
      'https://custom-blockscout.example/api?apikey=user-key',
      true
    );

    expect(
      requestedUrls().map((url) => url.searchParams.get('action'))
    ).toEqual(['txlist', 'pendingtxlist', 'tokentx']);
    for (const url of requestedUrls()) {
      expect(url.searchParams.get('apikey')).toBe('user-key');
    }
    expect(fetchRoutescan).not.toHaveBeenCalled();
  });
});
