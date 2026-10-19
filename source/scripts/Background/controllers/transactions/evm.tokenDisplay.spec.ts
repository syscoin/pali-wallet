import { retryableFetch } from '@sidhujag/sysweb3-network';

import store from 'state/store';
import { getTransactionDisplayInfo } from 'utils/transactions';

import EvmTransactionsController from './evm';

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn(), dispatch: jest.fn() },
}));
jest.mock('state/vault', () => ({ setActiveAccountProperty: jest.fn() }));
jest.mock('@sidhujag/sysweb3-network', () => ({
  retryableFetch: jest.fn(),
  INetworkType: { Ethereum: 'ethereum' },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({}));
jest.mock('./smartAccountHistory', () => ({}));
jest.mock('./utils', () => ({}));
jest.mock('utils/tokenDiscovery', () => ({
  isRoutescanApiUrl: () => false,
  fetchRoutescan: jest.fn(),
}));

const OWNER = `0x${'11'.repeat(20)}`;
const SENDER = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const HASH = `0x${'aa'.repeat(32)}`;
const API = 'https://explorer.invalid/api';
const importedToken = {
  chainId: 1,
  contractAddress: TOKEN,
  tokenSymbol: 'USDC',
  decimals: 6,
  isNft: false,
};
const tokenEvent = {
  hash: HASH,
  from: SENDER,
  to: OWNER,
  contractAddress: TOKEN,
  value: '1000000',
  tokenName: 'USD Coin',
  tokenSymbol: 'USDC',
  tokenDecimal: '6',
  blockNumber: '123',
  timeStamp: '1700000000',
  confirmations: '3',
  nonce: '2',
  input: '0x',
};
const state = (assets: any[] = [importedToken]) => ({
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: { chainId: 1, url: 'https://rpc.invalid' },
    accounts: {
      HDAccount: {
        0: { address: OWNER, evmTxCountByChainId: { 1: 1 } },
      },
    },
    accountAssets: { HDAccount: { 0: { ethereum: assets } } },
  },
});
const replies = (base: any[], events: any[]) => {
  jest.mocked(retryableFetch).mockImplementation(
    async (endpoint) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          status: '1',
          message: 'OK',
          result:
            new URL(String(endpoint)).searchParams.get('action') === 'tokentx'
              ? events
              : base,
        }),
      } as Response)
  );
};
const fetchRows = async (page = false) => {
  const controller = EvmTransactionsController();
  const result = page
    ? await controller.fetchTransactionsPageFromAPI(OWNER, 1, API, 2, 2)
    : await controller.fetchTransactionsFromAPI(OWNER, 1, API);
  expect(result.error).toBeUndefined();
  return result.transactions!;
};

beforeEach(() => {
  jest.clearAllMocks();
  (store.getState as jest.Mock).mockReturnValue(state());
  replies([], [tokenEvent]);
});

it.each([false, true])(
  'displays a received ERC-20 event without calldata (paginated=%s)',
  async (page) => {
    const rows = await fetchRows(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      historySource: 'explorer-tokentx',
      input: '0x',
      tokenRecipient: OWNER,
      tokenTransfer: {
        chainId: 1,
        contractAddress: TOKEN,
        recipient: OWNER,
        value: '1000000',
        decimals: '6',
      },
    });
    await expect(
      getTransactionDisplayInfo(rows[0], 'ETH', true)
    ).resolves.toMatchObject({
      actualRecipient: OWNER,
      displayValue: '1.0',
      displaySymbol: 'USDC',
      isErc20Transfer: true,
      isNft: false,
    });
  }
);

it('uses valid event metadata when the token is not imported', async () => {
  (store.getState as jest.Mock).mockReturnValue(state([]));
  const [row] = await fetchRows();
  await expect(
    getTransactionDisplayInfo(row, 'ETH', true)
  ).resolves.toMatchObject({
    displayValue: '1.0',
    displaySymbol: 'USDC',
    isErc20Transfer: true,
  });
});

it('cannot label an event using imported metadata from a different chain', async () => {
  (store.getState as jest.Mock).mockReturnValue(
    state([
      { ...importedToken, chainId: 57, tokenSymbol: 'WRONG', decimals: 18 },
    ])
  );
  const [row] = await fetchRows();
  await expect(
    getTransactionDisplayInfo(row, 'ETH', true)
  ).resolves.toMatchObject({
    displayValue: '1.0',
    displaySymbol: 'USDC',
    isErc20Transfer: true,
  });
});

it('keeps a token with unknown decimals as raw token units', async () => {
  (store.getState as jest.Mock).mockReturnValue(state([]));
  replies(
    [],
    [{ ...tokenEvent, tokenDecimal: undefined, tokenSymbol: undefined }]
  );
  const [row] = await fetchRows();
  await expect(
    getTransactionDisplayInfo(row, 'ETH', true)
  ).resolves.toMatchObject({
    displayValue: '1000000',
    displaySymbol: '0x3333...3333',
    isErc20Transfer: true,
    hasUnknownDecimals: true,
  });
});

it('supports persisted event rows that predate the explicit event payload', async () => {
  const [row] = await fetchRows();
  delete row.tokenTransfer;
  await expect(
    getTransactionDisplayInfo(row, 'ETH', true)
  ).resolves.toMatchObject({
    actualRecipient: OWNER,
    displayValue: '1.0',
    displaySymbol: 'USDC',
    isErc20Transfer: true,
  });
});

it('preserves an ERC-721 transfer proved by token id zero', async () => {
  (store.getState as jest.Mock).mockReturnValue(state([]));
  replies(
    [],
    [{ ...tokenEvent, value: undefined, tokenID: '0', tokenSymbol: 'ART' }]
  );
  const [row] = await fetchRows();
  await expect(
    getTransactionDisplayInfo(row, 'ETH', true)
  ).resolves.toMatchObject({
    actualRecipient: OWNER,
    displayValue: '1',
    displaySymbol: 'ART',
    isErc20Transfer: true,
    isNft: true,
    tokenId: '0',
  });
});

it('preserves an ERC-1155 event count beyond JavaScript integer precision', async () => {
  (store.getState as jest.Mock).mockReturnValue(state([]));
  replies(
    [],
    [
      {
        ...tokenEvent,
        tokenValue: '9007199254740993',
        tokenID: '7',
        tokenType: 'ERC-1155',
        tokenSymbol: 'ART',
      },
    ]
  );
  const [row] = await fetchRows();
  await expect(
    getTransactionDisplayInfo(row, 'ETH', true)
  ).resolves.toMatchObject({
    displayValue: '9007199254740993',
    displaySymbol: 'ART',
    isNft: true,
    tokenId: '7',
  });
});

it.each([false, true])(
  'retains the outer native payment and one row when the token event has the same hash (paginated=%s)',
  async (page) => {
    replies(
      [{ ...tokenEvent, to: TOKEN, value: '2000000000000000000' }],
      [{ ...tokenEvent, hash: HASH.toUpperCase() }]
    );
    const rows = await fetchRows(page);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenTransfer).toBeUndefined();
    expect(rows[0]).toMatchObject({
      to: TOKEN,
      value: '2000000000000000000',
      historySource: 'explorer-txlist',
    });
    await expect(
      getTransactionDisplayInfo(rows[0], 'ETH', true)
    ).resolves.toMatchObject({
      actualRecipient: TOKEN,
      displayValue: 2,
      displaySymbol: 'ETH',
      isErc20Transfer: false,
    });
  }
);
