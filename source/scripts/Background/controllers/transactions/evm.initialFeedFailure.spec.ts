import { configureStore } from '@reduxjs/toolkit';

import { isEvmHistoryIncomplete } from '../../../../shared/evmHistory';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { ROLLUX_DEFAULT_NETWORK } from 'utils/constants';

import EvmTransactionsController from './evm';
import TransactionsManager from './index';

let mockStore: any;
let mockWallet: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({ wallet: mockWallet }),
  notificationManager: {
    cleanup: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Ledger: 'Ledger',
    Trezor: 'Trezor',
    SmartAccount: 'SmartAccount',
  },
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

const OWNER = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'22'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const TOKEN_HASH = `0x${'ab'.repeat(32)}`;
const OLD_HASH = `0x${'cd'.repeat(32)}`;
const network = ROLLUX_DEFAULT_NETWORK.network;
type Mode =
  | 'empty'
  | 'tokens'
  | 'base500-tokenHealthy'
  | 'base500-tokenEmpty'
  | 'base500-tokenNonArray'
  | 'base500-tokenJsonFailure'
  | 'optionalPendingFailure'
  | 'both500'
  | 'bothReject';
let mode: Mode;
let reads: string[];
let provider: any;
let manager: ReturnType<typeof TransactionsManager>;
let originalFetch: typeof fetch;
const tokenRow = {
  hash: TOKEN_HASH,
  from: OTHER,
  to: OWNER,
  contractAddress: TOKEN,
  value: '17',
  tokenDecimal: '0',
  tokenSymbol: 'PROOF',
  blockNumber: '50',
  blockHash: `0x${'ef'.repeat(32)}`,
  confirmations: '51',
  timeStamp: '1700000100',
  nonce: '1',
  input: '0x',
  gas: '21000',
  gasPrice: '1',
};
const oldRow = {
  hash: OLD_HASH,
  from: OWNER,
  to: OTHER,
  value: '1',
  blockNumber: 40,
  blockHash: `0x${'ed'.repeat(32)}`,
  confirmations: 60,
  timestamp: 1700000000,
  nonce: 0,
  chainId: network.chainId,
  input: '0x',
};
const response = (status: number, result: unknown) =>
  ({
    ok: status === 200,
    status,
    statusText: status === 200 ? 'OK' : 'Synthetic failure',
    text: async () => 'Synthetic explorer failure',
    json: async () => ({ status: '1', message: 'OK', result }),
  } as unknown as Response);
const account = () => mockStore.getState().vault.accounts.HDAccount[0];
const rows = () =>
  mockStore.getState().vault.accountTransactions.HDAccount[0].ethereum[
    network.chainId
  ];
const update = () =>
  manager.utils.updateTransactionsFromCurrentAccount(
    account(),
    false,
    network.url,
    mockStore.getState().vault.accountTransactions.HDAccount[0],
    true
  );
const settle = async (promise: Promise<any>) => {
  const [result] = await Promise.allSettled([promise]);
  return result.status === 'fulfilled'
    ? { status: result.status, value: result.value }
    : { status: result.status, error: String(result.reason) };
};

beforeEach(() => {
  jest.clearAllMocks();
  reads = [];
  mode = 'empty';
  const initial = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...initial,
        activeNetwork: network,
        isBitcoinBased: false,
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: {
              id: 0,
              label: 'Synthetic public account',
              address: OWNER,
              balances: { ethereum: '1' },
              evmTxCountByChainId: { [network.chainId]: 1 },
            },
          },
        },
        accountTransactions: {
          HDAccount: {
            0: { ethereum: { [network.chainId]: [] }, syscoin: {} },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
    middleware: (defaults) => defaults({ serializableCheck: false }),
  });
  // These public provider read fixtures exercise the real finite-block fallback.
  provider = {
    getTransactionCount: jest.fn().mockResolvedValue(0),
    getBlockNumber: jest.fn().mockResolvedValue(100),
    signal: new AbortController().signal,
    readMany: jest.fn(async (requests: { method: string; params: any[] }[]) =>
      requests.map(({ method, params }) => {
        if (method === 'eth_chainId')
          return {
            status: 'fulfilled',
            value: `0x${network.chainId.toString(16)}`,
          };
        if (method !== 'eth_getBlockByNumber')
          throw new Error('Unexpected provider method');
        const number = params[0] === 'latest' ? 100 : Number(BigInt(params[0]));
        const blockHash = (height: number) =>
          `0x${BigInt(height + 1)
            .toString(16)
            .padStart(64, '0')}`;
        return {
          status: 'fulfilled',
          value: {
            number: `0x${number.toString(16)}`,
            hash: blockHash(number),
            parentHash: blockHash(number - 1),
            timestamp: '0x6553f100',
            transactions: [],
          },
        };
      })
    ),
  };
  manager = TransactionsManager();
  manager.utils.clearCache();
  mockWallet = Object.create(MainController.prototype);
  Object.assign(mockWallet, {
    assertWalletReadyForSigning: () => undefined,
    getActiveKeyring: () => ({
      ethereumTransaction: { web3Provider: provider },
    }),
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: manager,
    reconcileLocalPendingEvmSmartAccountTransactions: jest
      .fn()
      .mockResolvedValue(undefined),
    refreshBalancesAfterHistory: jest.fn(),
  });
  originalFetch = globalThis.fetch;
  // Keep the installed retryableFetch intact; replace only public HTTP replies.
  globalThis.fetch = jest.fn(async (input: any, options: any) => {
    const url = new URL(String(input));
    const action = url.searchParams.get('action')!;
    if (
      url.origin !== new URL(network.apiUrl!).origin ||
      url.pathname !== '/api' ||
      url.searchParams.get('module') !== 'account' ||
      url.searchParams.get('address') !== OWNER ||
      !['txlist', 'tokentx', 'pendingtxlist'].includes(action) ||
      (options?.method && options.method !== 'GET')
    )
      throw new Error('Non-fixture public request denied');
    reads.push(action);
    if (mode === 'bothReject')
      throw new Error('Synthetic explorer transport failure');
    if (
      mode === 'both500' ||
      (mode.startsWith('base500-') && action !== 'tokentx') ||
      (mode === 'optionalPendingFailure' && action === 'pendingtxlist')
    )
      return response(500, []);
    if (mode === 'base500-tokenNonArray')
      return response(200, 'Rate limit exceeded');
    if (mode === 'base500-tokenJsonFailure')
      return {
        ...response(200, []),
        json: async () => {
          throw new SyntaxError('Synthetic malformed token JSON');
        },
      };
    return response(
      200,
      action === 'tokentx' &&
        ['tokens', 'base500-tokenHealthy', 'optionalPendingFailure'].includes(
          mode
        )
        ? [tokenRow]
        : []
    );
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  manager.utils.clearCache();
  jest.restoreAllMocks();
});

it('retries incomplete Smart discovery instead of caching empty history', async () => {
  mockStore.getState().vault.accounts.HDAccount[0].isSmartAccount = true;
  let fail = true;
  const original = provider.readMany.getMockImplementation();
  provider.readMany.mockImplementation(
    async (requests: any[], options: any) => {
      if (requests[0].method === 'eth_getLogs')
        return [
          {
            status: fail ? 'rejected' : 'fulfilled',
            ...(fail ? { reason: Error('offline') } : { value: [] }),
          },
        ];
      if (requests[0].method === 'eth_blockNumber')
        return [{ status: 'fulfilled', value: '0x64' }];
      return original(requests, options);
    }
  );
  expect(isEvmHistoryIncomplete(await update())).toBe(true);
  fail = false;
  expect(isEvmHistoryIncomplete(await update())).toBe(false);
  await update();
  expect(
    provider.readMany.mock.calls.filter(
      ([requests]) => requests[0].method === 'eth_getLogs'
    )
  ).toHaveLength(2);
});

it.each(['rejected', 'null', 'genesis', 'healthy'])(
  'requires a fulfilled valid Smart history head before caching (%s)',
  async (head) => {
    mockStore.getState().vault.accounts.HDAccount[0].isSmartAccount = true;
    const original = provider.readMany.getMockImplementation();
    let recover = false;
    provider.readMany.mockImplementation(
      async (requests: any[], options: any) => {
        if (requests[0].method === 'eth_blockNumber')
          return [
            !recover && head === 'rejected'
              ? { status: 'rejected', reason: Error('head unavailable') }
              : {
                  status: 'fulfilled',
                  value: recover
                    ? '0x64'
                    : head === 'null'
                    ? null
                    : head === 'genesis'
                    ? '0x0'
                    : '0x64',
                },
          ];
        if (requests[0].method === 'eth_getLogs')
          return [{ status: 'fulfilled', value: [] }];
        return original(requests, options);
      }
    );
    const first = await update();
    const failed = head === 'rejected' || head === 'null';
    expect(isEvmHistoryIncomplete(first)).toBe(failed);
    if (failed) {
      expect(
        mockStore.getState().vault.accounts.HDAccount[0]
          .smartAccountUserOpScanByChainId
      ).toBeUndefined();
      expect(
        provider.readMany.mock.calls.some(
          ([calls]) => calls[0].method === 'eth_getLogs'
        )
      ).toBe(false);
    } else {
      expect(
        mockStore.getState().vault.accounts.HDAccount[0]
          .smartAccountUserOpScanByChainId
      ).toEqual({ [network.chainId]: head === 'genesis' ? 0 : 100 });
    }
    const before = provider.readMany.mock.calls.length;
    recover = true;
    expect(isEvmHistoryIncomplete(await update())).toBe(false);
    expect(provider.readMany.mock.calls.length > before).toBe(failed);
  }
);

it('retires a held pagination hint before starting explorer requests through MainController', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider.readMany.mockImplementationOnce(
    async (requests: any[], options: any) => {
      expect(requests).toEqual([
        { method: 'eth_getTransactionCount', params: [OWNER, 'latest'] },
      ]);
      expect(options.signal.aborted).toBe(false);
      entered();
      await held;
      expect(options.signal.aborted).toBe(true);
      return [{ status: 'fulfilled', value: '0x1' }];
    }
  );
  mockStore.dispatch({
    type: 'vault/setActiveAccountProperty',
    payload: {
      property: 'evmTxCountByChainId',
      value: { [network.chainId]: 0 },
    },
  });
  const result = settle(
    mockWallet.updateUserTransactionsState({
      isBitcoinBased: false,
      activeNetwork: network,
      isPolling: true,
    })
  );
  await started;
  mockWallet.cancellablePromises.transactionPromise.cancel();
  expect((await result).status).toBe('rejected');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  expect(reads).toEqual([]);
  expect(provider.signal.aborted).toBe(false);
});

it('accepts validated empty base and token feeds', async () => {
  const result = await EvmTransactionsController().fetchTransactionsFromAPI(
    OWNER,
    network.chainId,
    network.apiUrl
  );
  expect(result).toMatchObject({ transactions: [], error: undefined });
  expect(reads).toEqual(['txlist', 'tokentx']);
});

it('preserves a healthy empty token fallback after the base feed fails', async () => {
  mode = 'base500-tokenEmpty';
  await expect(
    EvmTransactionsController().fetchTransactionsFromAPI(
      OWNER,
      network.chainId,
      network.apiUrl
    )
  ).resolves.toEqual({
    transactions: [],
    error: 'Explorer transaction history unavailable',
    hasMore: false,
  });
});

it('preserves received token rows and provenance after the base feed fails', async () => {
  mode = 'base500-tokenHealthy';
  const result = await EvmTransactionsController().fetchTransactionsFromAPI(
    OWNER,
    network.chainId,
    network.apiUrl
  );
  expect(result.error).toBe('Explorer transaction history unavailable');
  expect(result.transactions).toEqual([
    expect.objectContaining({
      hash: TOKEN_HASH,
      tokenRecipient: OWNER,
      to: TOKEN,
      historySource: 'explorer-tokentx',
    }),
  ]);
});

it.each(['both500', 'bothReject'] as const)(
  'rejects failed required feeds instead of claiming an empty success: %s',
  async (failure) => {
    mode = failure;
    const result = await EvmTransactionsController().fetchTransactionsFromAPI(
      OWNER,
      network.chainId,
      network.apiUrl
    );
    expect(result.transactions).toBeNull();
    expect(result.error).toMatch(/Explorer API request failed/);
  }
);

it.each(['base500-tokenNonArray', 'base500-tokenJsonFailure'] as const)(
  'rejects a malformed token fallback after the base feed fails: %s',
  async (failure) => {
    mode = failure;
    const result = await EvmTransactionsController().fetchTransactionsFromAPI(
      OWNER,
      network.chainId,
      network.apiUrl
    );
    expect(result.transactions).toBeNull();
    expect(result.error).toMatch(/Explorer API request failed/);
  }
);

it('retains healthy token history when only the optional pending feed fails', async () => {
  mode = 'optionalPendingFailure';
  const result = await EvmTransactionsController().fetchTransactionsFromAPI(
    OWNER,
    network.chainId,
    network.apiUrl,
    true
  );
  expect(result.error).toBeUndefined();
  expect(result.transactions?.map((row) => row.hash)).toEqual([TOKEN_HASH]);
  expect(reads).toEqual(['txlist', 'pendingtxlist', 'tokentx']);
});

it('caches validated empty history without repeating the public reads', async () => {
  expect(await update()).toEqual([]);
  expect(reads).toHaveLength(3);
  expect(await update()).toEqual([]);
  expect(reads).toHaveLength(3);
  expect(
    provider.readMany.mock.calls
      .flatMap(([calls]) => calls)
      .filter(
        ({ method, params }) => method === 'eth_getBlockByNumber' && params[1]
      )
  ).toHaveLength(21);
});

it.each(['both500', 'bothReject'] as const)(
  'does not cache a failed initial read and accepts immediate healthy recovery: %s',
  async (failure) => {
    mode = failure;
    const first = await settle(update());
    expect(reads).toHaveLength(3);
    mode = 'tokens';
    const second = await settle(update());
    expect({
      firstStatus: first.status,
      secondHashes:
        second.status === 'fulfilled'
          ? second.value.map((row: any) => row.hash)
          : [],
      finalReads: reads.length,
    }).toEqual({
      firstStatus: 'rejected',
      secondHashes: [TOKEN_HASH],
      finalReads: 6,
    });
    expect(provider.readMany).not.toHaveBeenCalled();
  }
);

it('preserves current MainController rows on failure and adds recovered rows on the next ordinary poll', async () => {
  mockStore.dispatch({
    type: 'vault/setAccountTransactions',
    payload: {
      chainId: network.chainId,
      networkType: 'ethereum',
      transactions: [oldRow],
    },
  });
  expect(rows()).toEqual([oldRow]);
  const refresh = () =>
    mockWallet.updateUserTransactionsState({
      isBitcoinBased: false,
      activeNetwork: network,
      isPolling: true,
    });
  mode = 'both500';
  const first = await settle(refresh());
  const preservedAfterFailure = rows().map((row: any) => row.hash);
  expect(reads).toHaveLength(3);
  mode = 'tokens';
  await refresh();
  expect({
    firstStatus: first.status,
    preservedAfterFailure,
    finalRows: rows().map((row: any) => row.hash),
    finalReads: reads.length,
  }).toEqual({
    firstStatus: 'rejected',
    preservedAfterFailure: [OLD_HASH],
    finalRows: [TOKEN_HASH, OLD_HASH],
    finalReads: 6,
  });
});
