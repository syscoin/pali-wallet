import TransactionsManager from './index';

const mockEvmPolling = jest.fn();
const mockUtxoPolling = jest.fn();
const mockProvider = {};
let mockVault: any;

jest.mock('scripts/Background', () => ({
  getController: () => ({
    wallet: { ethereumTransaction: { web3Provider: mockProvider } },
  }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: mockVault }) },
}));
jest.mock('./evm', () => ({
  __esModule: true,
  default: () => ({ pollingEvmTransactions: mockEvmPolling }),
}));
jest.mock('./syscoin', () => ({
  __esModule: true,
  default: () => ({ pollingSysTransactions: mockUtxoPolling }),
}));

const account = { address: '0x' + '11'.repeat(20), xpub: 'fixture-xpub' };
const rpc = 'https://rpc.example';
const originalApi = 'https://old-explorer.example/api';
const updatedApi = 'https://new-explorer.example/api';
let manager: ReturnType<typeof TransactionsManager>;
const read = (
  options: {
    bypassCompleted?: boolean;
    force?: boolean;
    pending?: boolean;
    rapid?: boolean;
    scope?: string;
    utxo?: boolean;
  } = {}
) =>
  manager.utils.updateTransactionsFromCurrentAccount(
    account as any,
    Boolean(options.utxo),
    rpc,
    {
      [options.utxo ? 'syscoin' : 'ethereum']: {
        5700: options.pending ? [{ blockNumber: null }] : [],
      },
    } as any,
    true,
    Boolean(options.rapid),
    Boolean(options.force),
    options.scope,
    undefined,
    options.bypassCompleted
  );

beforeEach(() => {
  manager = TransactionsManager();
  manager.utils.clearCache();
  mockVault = {
    activeNetwork: { chainId: 5700, url: rpc, apiUrl: originalApi },
  };
  mockEvmPolling
    .mockReset()
    .mockImplementation(async () => [
      { hash: 'observed-' + mockVault.activeNetwork.apiUrl, blockNumber: 1 },
    ]);
  mockUtxoPolling
    .mockReset()
    .mockResolvedValue([{ txid: 'utxo', blockHeight: 1 }]);
});

afterEach(() => {
  manager.utils.clearCache();
  jest.restoreAllMocks();
});

it('fetches from the changed active explorer API instead of reusing the previous API result', async () => {
  const first = await read();
  expect(first).toEqual([{ hash: 'observed-' + originalApi, blockNumber: 1 }]);
  mockVault.activeNetwork = { ...mockVault.activeNetwork, apiUrl: updatedApi };
  const second = await read();
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
  expect(second).toEqual([{ hash: 'observed-' + updatedApi, blockNumber: 1 }]);
  expect(second).not.toBe(first);
});

it('reuses the cache for an unchanged account, RPC and API', async () => {
  const first = await read();
  expect(await read()).toBe(first);
  expect(mockEvmPolling).toHaveBeenCalledTimes(1);
});

it('bypasses the cache for a pending transaction without changing the endpoint', async () => {
  const first = await read();
  expect(await read({ pending: true })).not.toBe(first);
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
});

it('preserves explicit force-refresh behavior', async () => {
  const first = await read();
  expect(await read({ force: true })).not.toBe(first);
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
});

it('keeps the existing one-minute expiration', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const first = await read();
  now.mockReturnValue(60999);
  expect(await read()).toBe(first);
  now.mockReturnValue(61000);
  expect(await read()).not.toBe(first);
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
});

it('continues using the RPC cache for UTXO polling', async () => {
  const first = await read({ utxo: true });
  mockVault.activeNetwork.apiUrl = updatedApi;
  expect(await read({ utxo: true })).toBe(first);
  expect(mockUtxoPolling).toHaveBeenCalledTimes(1);
  expect(mockUtxoPolling).toHaveBeenCalledWith(account.xpub, rpc, false);
  expect(mockEvmPolling).not.toHaveBeenCalled();
});

it('refetches when an API is added to an existing RPC-only configuration', async () => {
  mockVault.activeNetwork.apiUrl = undefined;
  await read();
  mockVault.activeNetwork.apiUrl = updatedApi;
  expect(await read()).toEqual([
    { hash: 'observed-' + updatedApi, blockNumber: 1 },
  ]);
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
});

it('refetches through RPC when the active explorer API is removed', async () => {
  await read();
  mockVault.activeNetwork.apiUrl = undefined;
  expect(await read()).toEqual([
    { hash: 'observed-undefined', blockNumber: 1 },
  ]);
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
});

const deferred = () => {
  let resolve!: (value: any[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any[]>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

it.each([false, true])(
  'caches only the newest overlapping network result (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const old = deferred();
    const fresh = [{ hash: 'fresh', txid: 'fresh', blockNumber: 2 }];
    poll.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
    const older = read({ utxo, force: true });
    expect(await read({ utxo, force: true })).toBe(fresh);
    old.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await older;
    expect(await read({ utxo })).toBe(fresh);
    expect(poll).toHaveBeenCalledTimes(2);
  }
);

it.each([false, true])(
  'retries instead of reviving an old cache after overlapping fresh reads fail (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    await read({ utxo });
    const old = deferred();
    const newer = deferred();
    poll.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const olderRead = read({ utxo, force: true });
    const newerRead = read({ utxo, force: true });
    const rejected = expect(newerRead).rejects.toThrow('offline');
    newer.reject(new Error('offline'));
    await rejected;
    old.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await olderRead;
    const recovered = [
      { hash: 'recovered', txid: 'recovered', blockNumber: 2 },
    ];
    poll.mockResolvedValueOnce(recovered);
    expect(await read({ utxo })).toBe(recovered);
    expect(poll).toHaveBeenCalledTimes(4);
  }
);

it.each([false, true])(
  'does not serve old completed cache while a forced refresh is in flight (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    await read({ utxo });
    const old = deferred();
    const fresh = [{ hash: 'fresh', txid: 'fresh', blockNumber: 2 }];
    poll.mockReturnValueOnce(old.promise);
    const forced = read({ utxo, force: true });
    const ordinary = read({ utxo });
    expect(poll).toHaveBeenCalledTimes(2);
    old.resolve(fresh);
    expect(await forced).toBe(fresh);
    expect(await ordinary).toBe(fresh);
    expect(await read({ utxo })).toBe(fresh);
    expect(poll).toHaveBeenCalledTimes(2);
  }
);

it.each([false, true])(
  'retries an expired forced read with full history instead of rapid local state (utxo=%s)',
  async (utxo) => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const old = deferred();
    const fresh = [{ hash: 'fresh', txid: 'fresh', blockNumber: 2 }];
    poll.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
    const forced = read({ utxo, force: true, scope: '1:1' });
    now.mockReturnValue(6000);
    const joined = read({ utxo, rapid: true, scope: '1:1' });
    expect(poll).toHaveBeenCalledTimes(1);
    now.mockReturnValue(6001);
    expect(await read({ utxo, rapid: true, scope: '1:1' })).toBe(fresh);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll.mock.calls[1][2]).toBe(false);
    old.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await Promise.all([forced, joined]);
    expect(await read({ utxo })).toBe(fresh);
  }
);

it.each([false, true])(
  'does not join a forced read from an earlier wallet or network scope (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const old = deferred();
    const fresh = [{ hash: 'fresh', txid: 'fresh', blockNumber: 2 }];
    poll.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
    const forced = read({ utxo, force: true, scope: '1:1' });
    expect(await read({ utxo, scope: '2:1' })).toBe(fresh);
    expect(poll).toHaveBeenCalledTimes(2);
    old.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await forced;
    expect(await read({ utxo, scope: '2:1' })).toBe(fresh);
  }
);

it('does not join a cleared in-flight forced request', async () => {
  const old = deferred();
  const fresh = [{ hash: 'fresh', blockNumber: 2 }];
  mockEvmPolling.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
  const forced = read({ force: true });
  manager.utils.clearCache();
  expect(await read()).toBe(fresh);
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
  old.resolve([{ hash: 'old', blockNumber: 1 }]);
  await forced;
  expect(await read()).toBe(fresh);
});

it.each([false, true])(
  'coalesces ordinary full reads for the same account and endpoint (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const response = deferred();
    const fresh = [{ hash: 'fresh', txid: 'fresh', blockNumber: 2 }];
    poll.mockReturnValueOnce(response.promise);
    const first = read({ utxo });
    const second = read({ utxo });
    expect(poll).toHaveBeenCalledTimes(1);
    response.resolve(fresh);
    expect(await first).toBe(fresh);
    expect(await second).toBe(fresh);
  }
);

it.each([false, true])(
  'does not let a full read join an earlier rapid local snapshot (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const response = deferred();
    const fresh = [{ hash: 'fresh', txid: 'fresh', blockNumber: 2 }];
    poll.mockReturnValueOnce(response.promise).mockResolvedValueOnce(fresh);
    const rapid = read({ utxo, rapid: true });
    expect(await read({ utxo })).toBe(fresh);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll.mock.calls.map((args: any[]) => args[2])).toEqual([
      true,
      false,
    ]);
    response.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await rapid;
    expect(await read({ utxo })).toBe(fresh);
  }
);

it.each([false, true])(
  'does not repopulate a cleared cache from an older in-flight read (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const old = deferred();
    const fresh = [{ hash: 'fresh', txid: 'fresh', blockNumber: 2 }];
    poll.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
    const pending = read({ utxo, force: true });
    manager.utils.clearCache();
    old.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await pending;
    expect(await read({ utxo })).toBe(fresh);
    expect(poll).toHaveBeenCalledTimes(2);
  }
);

it('keeps independent endpoint cache writers independent', async () => {
  const old = deferred();
  const firstEndpoint = [{ hash: 'first-endpoint', blockNumber: 1 }];
  const secondEndpoint = [{ hash: 'second-endpoint', blockNumber: 2 }];
  mockEvmPolling
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(secondEndpoint);
  const first = read({ force: true });
  mockVault.activeNetwork.apiUrl = updatedApi;
  expect(await read({ force: true })).toBe(secondEndpoint);
  old.resolve(firstEndpoint);
  await first;
  expect(await read()).toBe(secondEndpoint);
  mockVault.activeNetwork.apiUrl = originalApi;
  expect(await read()).toBe(firstEndpoint);
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  'manual cache bypass coalesces repeated fresh reads (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    await read({ utxo });
    const response = deferred();
    poll.mockReturnValueOnce(response.promise);
    const first = read({ utxo, bypassCompleted: true, scope: '1:1' });
    const second = read({ utxo, bypassCompleted: true, scope: '1:1' });
    expect(poll).toHaveBeenCalledTimes(2);
    const fresh = [{ hash: 'manual', txid: 'manual', blockNumber: 2 }];
    response.resolve(fresh);
    expect(await first).toBe(fresh);
    expect(await second).toBe(fresh);
  }
);

it.each([false, true])(
  'manual cache bypass joins a current ordinary full read (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const response = deferred();
    poll.mockReturnValueOnce(response.promise);
    const ordinary = read({ utxo, scope: '1:1' });
    const manual = read({ utxo, bypassCompleted: true, scope: '1:1' });
    expect(poll).toHaveBeenCalledTimes(1);
    const fresh = [{ hash: 'manual', txid: 'manual', blockNumber: 2 }];
    response.resolve(fresh);
    expect(await ordinary).toBe(fresh);
    expect(await manual).toBe(fresh);
  }
);

it.each([false, true])(
  'manual cache bypass retries an expired full read without weakening its deadline (utxo=%s)',
  async (utxo) => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const response = deferred();
    const fresh = [{ hash: 'manual', txid: 'manual', blockNumber: 2 }];
    poll.mockReturnValueOnce(response.promise).mockResolvedValueOnce(fresh);
    const first = read({ utxo, bypassCompleted: true, scope: '1:1' });
    now.mockReturnValue(6000);
    const joined = read({ utxo, bypassCompleted: true, scope: '1:1' });
    expect(poll).toHaveBeenCalledTimes(1);
    now.mockReturnValue(6001);
    expect(await read({ utxo, bypassCompleted: true, scope: '1:1' })).toBe(
      fresh
    );
    expect(poll).toHaveBeenCalledTimes(2);
    response.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await Promise.all([first, joined]);
    expect(await read({ utxo, scope: '1:1' })).toBe(fresh);
  }
);

it.each([false, true])(
  'manual cache bypass does not join an older request scope (utxo=%s)',
  async (utxo) => {
    const poll = utxo ? mockUtxoPolling : mockEvmPolling;
    const response = deferred();
    const fresh = [{ hash: 'manual', txid: 'manual', blockNumber: 2 }];
    poll.mockReturnValueOnce(response.promise).mockResolvedValueOnce(fresh);
    const first = read({ utxo, bypassCompleted: true, scope: '1:1' });
    expect(await read({ utxo, bypassCompleted: true, scope: '2:1' })).toBe(
      fresh
    );
    expect(poll).toHaveBeenCalledTimes(2);
    response.resolve([{ hash: 'old', txid: 'old', blockNumber: 1 }]);
    await first;
    expect(await read({ utxo, scope: '2:1' })).toBe(fresh);
  }
);
