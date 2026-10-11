/** @jest-environment jsdom */
import {
  createBrowsingNavigationContext,
  clearNavigationState,
  clearTransactionNavigationState,
  getNavigationPersistencePolicy,
  getWalletNavigationScope,
  loadNavigationState,
  navigateBack,
  safeWalletPath,
  saveNavigationState,
  saveConfirmationReturnState,
} from './navigationState';

let mockStored: any;
let mockState: any;
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('./storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockGet(...args),
    setItem: (...args: any[]) => mockSet(...args),
    removeItem: (...args: any[]) => mockRemove(...args),
  },
}));
const reset = () => {
  mockStored = undefined;
  mockGet
    .mockReset()
    .mockImplementation(async () =>
      mockStored === undefined
        ? undefined
        : JSON.parse(JSON.stringify(mockStored))
    );
  mockSet.mockReset().mockImplementation(async (_key, value) => {
    mockStored = JSON.parse(JSON.stringify(value));
  });
  mockRemove.mockReset().mockImplementation(async () => {
    mockStored = undefined;
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
  document.body.innerHTML = '';
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: '0xa', xpub: 'public-a' } } },
      activeNetwork: {
        kind: 'Ethereum',
        chainId: 1,
        slip44: 60,
        url: 'https://rpc.test/secret-key',
        apiUrl: 'https://api.test?apikey=secret',
      },
    },
    vaultGlobal: { advancedSettings: { autolock: 0 } },
  };
};
beforeEach(reset);

it.each([true, false, 123])(
  'drops non-string transaction hash %s from a stored details snapshot',
  async (hash) => {
    await saveNavigationState('/home/details', undefined, {
      hash: 'valid-hash',
    });
    mockStored.state.hash = hash;
    const snapshot = await loadNavigationState();
    expect(snapshot?.state).not.toHaveProperty('hash');
  }
);

it('preserves a string transaction hash across popup restoration', async () => {
  const hash = 'a'.repeat(64);
  await saveNavigationState('/home/details', undefined, { hash });
  expect((await loadNavigationState())?.state.hash).toBe(hash);
});

it('restores only the paginated replacement lookup hash, not receipt evidence or payloads', async () => {
  const hash = `0x${'a'.repeat(64)}`;
  const winner = `0x${'B'.repeat(64)}`;
  await saveNavigationState('/home/details', undefined, {
    hash,
    replacementWinnerHash: winner,
    replacementWinner: { hash: winner, blockNumber: 42, signed: 'private' },
    tx: { hash, input: 'private' },
  });
  expect((await loadNavigationState())?.state).toEqual({
    hash,
    replacementWinnerHash: winner.toLowerCase(),
  });
  expect(JSON.stringify(mockStored)).not.toMatch(/private|blockNumber/);
});

it.each([true, 123, {}, [], 'https://rpc.test/secret', `0x${'a'.repeat(64)}`])(
  'drops an invalid or self-referential replacement lookup %j',
  async (replacementWinnerHash) => {
    await saveNavigationState('/home/details', undefined, {
      hash: `0x${'a'.repeat(64)}`,
      replacementWinnerHash,
    });
    expect((await loadNavigationState())?.state).not.toHaveProperty(
      'replacementWinnerHash'
    );
  }
);

it.each(['account', 'network'])(
  'drops a saved replacement lookup when the %s scope changes',
  async (field) => {
    await saveNavigationState('/home/details', undefined, {
      hash: `0x${'a'.repeat(64)}`,
      replacementWinnerHash: `0x${'b'.repeat(64)}`,
    });
    if (field === 'account') mockState.vault.activeAccount.id = 2;
    else mockState.vault.activeNetwork.chainId = 2;
    expect((await loadNavigationState())?.state).not.toHaveProperty(
      'replacementWinnerHash'
    );
  }
);

it('does not persist replacement lookups outside EVM transaction details', async () => {
  for (const hash of ['asset-id', `0x${'a'.repeat(64)}`]) {
    await saveNavigationState('/home?tab=activity', undefined, {
      hash,
      replacementWinnerHash: `0x${'b'.repeat(64)}`,
    });
    expect((await loadNavigationState())?.state).not.toHaveProperty(
      'replacementWinnerHash'
    );
  }
  await saveNavigationState('/home/details', undefined, {
    hash: 'asset-id',
    replacementWinnerHash: `0x${'b'.repeat(64)}`,
  });
  expect((await loadNavigationState())?.state).not.toHaveProperty(
    'replacementWinnerHash'
  );
});

it('restores exact amount and token ID strings without storing secrets, endpoints, verification or signed transaction fields', async () => {
  const amount = '0.000000000000000001';
  const tokenId =
    '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  await saveNavigationState('/send/eth', undefined, {
    formValues: {
      receiver: '0x1234',
      amount,
      nftTokenId: tokenId,
      password: 'private',
    },
    selectedAsset: {
      contractAddress: '0xtoken',
      isNft: true,
      tokenId,
      xprv: 'private',
    },
    verifiedTokenBalance: 42,
    tx: { signed: 'private' },
    phrase: 'private',
  });
  const snapshot = await loadNavigationState();
  expect(snapshot?.state?.formValues).toEqual({
    receiver: '0x1234',
    amount,
    nftTokenId: tokenId,
  });
  expect(snapshot?.state?.selectedAsset.tokenId).toBe(tokenId);
  expect(JSON.stringify(snapshot)).not.toMatch(
    /private|secret-key|apikey|verifiedTokenBalance|signed/
  );
});
it.each(['account', 'address', 'RPC', 'API', 'chain', 'kind'])(
  'drops operational drafts after %s changes',
  async (field) => {
    await saveNavigationState('/send/sys', undefined, {
      formValues: { amount: '123', receiver: 'sys-receiver' },
    });
    if (field === 'account') mockState.vault.activeAccount.id = 2;
    if (field === 'address')
      mockState.vault.accounts.HDAccount[0].address = 'replaced';
    if (field === 'RPC') mockState.vault.activeNetwork.url = 'https://other';
    if (field === 'API') mockState.vault.activeNetwork.apiUrl = 'https://other';
    if (field === 'chain') mockState.vault.activeNetwork.chainId = 2;
    if (field === 'kind') mockState.vault.activeNetwork.kind = 'Syscoin';
    expect(await loadNavigationState()).toBeNull();
  }
);
it.each([
  '/send/confirm',
  '/external/tx/send/ethTx',
  '/settings/seed',
  '/settings/account/private-key',
  '/settings/forget-wallet',
  '/phrase',
  '/settings/account/new',
  '/settings/account/import',
])('never resumes %s, including an injected snapshot', async (path) => {
  await saveNavigationState(path, undefined, {
    tx: 'unsafe',
    phrase: 'unsafe',
  });
  expect(mockStored).toBeUndefined();
  mockStored = {
    version: 2,
    timestamp: Date.now(),
    currentPath: path,
    walletScope: getWalletNavigationScope(),
    state: { tx: 'unsafe' },
  };
  expect(await loadNavigationState()).toBeNull();
});
it('retains nested browse origin, tab and marked inner scroll without duplicating query separators', async () => {
  document.body.innerHTML = '<div data-navigation-scroll="asset-list"></div>';
  (document.querySelector('div') as HTMLElement).scrollTop = 312;
  const context = createBrowsingNavigationContext({
    pathname: '/home',
    search: '?tab=assets',
    state: {
      homeAssets: {
        scope: 'public-scope',
        value: { searchValue: 'USDC', tokensVisibleCount: 150 },
      },
      returnContext: createBrowsingNavigationContext({
        pathname: '/settings/about',
      }),
    },
  });
  await saveNavigationState('/settings/advanced', undefined, {}, context);
  const saved = await loadNavigationState();
  const navigate = jest.fn();
  navigateBack(navigate, { state: { returnContext: saved?.returnContext } });
  expect(navigate).toHaveBeenCalledWith(
    '/home?tab=assets',
    expect.objectContaining({
      replace: true,
      state: expect.objectContaining({
        homeAssets: {
          scope: 'public-scope',
          value: { searchValue: 'USDC', tokensVisibleCount: 150 },
        },
        scrollPositions: { 'asset-list': 312 },
        returnContext: expect.objectContaining({
          returnRoute: '/settings/about',
        }),
      }),
    })
  );
});
it('returns to a same-network chooser after selection without restoring the previous account or drafts', () => {
  const scope = getWalletNavigationScope();
  const context = createBrowsingNavigationContext({
    pathname: '/home/smart-account',
    state: {
      smartAccountPicker: {
        open: true,
        search: 'Smart',
        network: scope.network,
        scrollTop: 88,
      },
      formValues: { receiver: 'old-account' },
      returnContext: createBrowsingNavigationContext({ pathname: '/home' }),
    },
  });
  mockState.vault.activeAccount.id = 1;
  const navigate = jest.fn();
  navigateBack(navigate, { state: { returnContext: context } });
  expect(navigate.mock.calls[0][1].state.smartAccountPicker).toEqual({
    open: true,
    search: 'Smart',
    network: scope.network,
    scrollTop: 88,
  });
  expect(navigate.mock.calls[0][1].state.formValues).toBeUndefined();
});
it.each([
  null,
  {},
  { version: 1 },
  { version: 2, currentPath: 'https://other.test/home', timestamp: Date.now() },
  { version: 2, currentPath: '/home', timestamp: Date.now() + 60_000 },
  { version: 2, currentPath: '/home', timestamp: Date.now() - 30 * 60_000 },
  {
    version: 2,
    currentPath: '/home',
    timestamp: Date.now(),
    state: { junk: 'x'.repeat(33_000) },
  },
])(
  'ignores malformed, legacy, future, expired or oversized snapshots',
  async (value) => {
    mockStored = value;
    expect(await loadNavigationState()).toBeNull();
  }
);
it('caps return-context depth and rejects external or secret parent chains', async () => {
  let context: any = createBrowsingNavigationContext({ pathname: '/home' });
  for (let i = 0; i < 30; i++)
    context = {
      ...createBrowsingNavigationContext({ pathname: '/settings/about' }),
      returnContext: context,
    };
  await saveNavigationState('/settings/advanced', undefined, {}, context);
  let count = 0;
  let cursor = (await loadNavigationState())?.returnContext;
  while (cursor) {
    count++;
    cursor = cursor.returnContext;
  }
  expect(count).toBeLessThanOrEqual(12);
  const navigate = jest.fn();
  navigateBack(navigate, {
    state: { returnContext: { returnRoute: '/settings/seed' } },
  });
  expect(navigate).toHaveBeenCalledWith('/home', { replace: true });
});
it('strips external payload parameters from local browsing routes', () => {
  expect(
    safeWalletPath('/home?tab=assets&data=private&externalRoute=tx/send#tokens')
  ).toBe('/home?tab=assets#tokens');
  expect(safeWalletPath('//evil.test/home')).toBeNull();
});

const publicCaller = () => ({
  ...createBrowsingNavigationContext({
    pathname: '/settings/account/smart-account-policy',
    search: '?view=modules',
    state: {
      id: 1,
      accountType: 'SmartAccount',
      smartAccountPolicyView: 'recovery',
    },
  }),
  scrollPosition: 81,
  scrollPositions: { 'wallet-layout': 217, 'smart-account-policy': 439 },
  returnContext: createBrowsingNavigationContext({
    pathname: '/home',
    search: '?tab=activity',
  }),
});
const unsignedCaller = (parent: any = publicCaller()) => ({
  ...createBrowsingNavigationContext({
    pathname: '/send/eth',
    state: {
      formValues: {
        receiver: 'synthetic-recipient',
        amount: '0.000000000000000001',
        password: 'secret-input',
      },
      selectedAsset: {
        contractAddress: 'synthetic-contract',
        symbol: 'TOKEN',
        xprv: 'secret-key',
      },
      tx: { signed: 'prepared-payload' },
      verifiedTokenBalance: 123,
    },
  }),
  returnContext: parent,
  scrollPosition: 32,
  scrollPositions: { 'wallet-layout': 74 },
});
const reviewState = (marker: any = false) => ({
  external: false,
  submissionStarted: marker,
  walletScope: getWalletNavigationScope(),
  tx: { nonce: 7, signed: 'prepared-payload', password: 'secret-input' },
  returnContext: unsignedCaller(),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const sharedLockManager = () => {
  let tail = Promise.resolve();
  let active = 0;
  let maxActive = 0;
  const request = jest.fn(
    (_name: string, options: any, work: () => Promise<any>) => {
      expect(options.mode).toBe('exclusive');
      const next = tail.then(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          return await work();
        } finally {
          active -= 1;
        }
      });
      tail = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    }
  );
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request },
  });
  return { request, getMaxActive: () => maxActive };
};
const separateDocument = () => {
  let module!: typeof import('./navigationState');
  jest.isolateModules(() => {
    module = require('./navigationState');
  });
  return module;
};

it.each([
  ['/home?tab=activity', 'save-browsing'],
  ['/settings/account/smart-account-policy', 'save-browsing'],
  ['/send/eth', 'form-owned-draft'],
  ['/send/sys', 'form-owned-draft'],
  ['/send/confirm', 'save-confirmation-caller'],
  ['/settings/seed', 'discard'],
  ['/settings/account/private-key', 'discard'],
  ['/external/tx/send/ethTx', 'discard'],
  ['/home?externalRoute=send', 'discard'],
  ['/home?route=send', 'discard'],
  ['https://other.test/home', 'discard'],
])('centrally classifies persistence for %s', (path, expected) => {
  expect(getNavigationPersistencePolicy(path)).toBe(expected);
});

it('persists idle review as an exact unsigned caller and parent, never its prepared transaction', async () => {
  await saveConfirmationReturnState(reviewState());
  const saved = await loadNavigationState();
  expect(saved?.currentPath).toBe('/send/eth');
  expect(saved?.state.formValues).toEqual({
    receiver: 'synthetic-recipient',
    amount: '0.000000000000000001',
  });
  expect(saved?.scrollPositions).toEqual({ 'wallet-layout': 74 });
  expect(saved?.returnContext?.returnRoute).toBe(
    '/settings/account/smart-account-policy?view=modules'
  );
  expect(saved?.returnContext?.scrollPositions).toEqual({
    'wallet-layout': 217,
    'smart-account-policy': 439,
  });
  expect(JSON.stringify(mockStored)).not.toMatch(
    /prepared-payload|secret-input|secret-key|verifiedTokenBalance|"tx"|"nonce"/
  );
});

it.each([true, undefined, null, 'false', 0, {}])(
  'projects marker %p to a public-only ancestor',
  async (marker) => {
    const state = reviewState();
    state.submissionStarted = marker;
    await saveConfirmationReturnState(state);
    expect((await loadNavigationState())?.currentPath).toBe(
      '/settings/account/smart-account-policy?view=modules'
    );
    expect(JSON.stringify(mockStored)).not.toMatch(
      /synthetic-recipient|synthetic-contract|formValues|prepared-payload|secret-input/
    );
  }
);

it.each(['external', 'account', 'network', 'invalid context'])(
  'rejects %s confirmation caller state',
  async (reason) => {
    await saveNavigationState('/home');
    const state = reviewState();
    if (reason === 'external') state.external = true;
    if (reason === 'account')
      state.walletScope = { ...state.walletScope, account: 'wrong' };
    if (reason === 'network')
      state.walletScope = { ...state.walletScope, network: 'wrong' };
    if (reason === 'invalid context')
      state.returnContext = { returnRoute: '//other.test/home' } as any;
    await saveConfirmationReturnState(state);
    expect(mockStored).toBeUndefined();
  }
);

it('transaction cleanup preserves public Policy as-is without refreshing TTL or writing', async () => {
  const caller = publicCaller();
  await saveNavigationState(
    caller.returnRoute,
    caller.tab,
    caller.state,
    caller.returnContext,
    caller
  );
  const before = JSON.stringify(mockStored);
  mockSet.mockClear();
  mockRemove.mockClear();
  await clearTransactionNavigationState();
  expect(JSON.stringify(mockStored)).toBe(before);
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
});

it('transaction failure cleanup discards a draft but keeps the Policy caller and its scroll', async () => {
  const caller = unsignedCaller();
  await saveNavigationState(
    caller.returnRoute,
    caller.tab,
    caller.state,
    caller.returnContext,
    caller
  );
  await clearTransactionNavigationState();
  expect(mockStored.currentPath).toBe(
    '/settings/account/smart-account-policy?view=modules'
  );
  expect(mockStored.scrollPositions).toEqual({
    'wallet-layout': 217,
    'smart-account-policy': 439,
  });
  expect(mockStored.returnContext.returnRoute).toBe('/home?tab=activity');
  expect(JSON.stringify(mockStored)).not.toMatch(
    /formValues|synthetic-recipient|prepared-payload/
  );
});

it('removes drafts nested under a public leaf too', async () => {
  await saveNavigationState('/receive', undefined, {}, unsignedCaller());
  await clearTransactionNavigationState();
  expect(mockStored.currentPath).toBe('/receive');
  expect(mockStored.returnContext.returnRoute).toBe(
    '/settings/account/smart-account-policy?view=modules'
  );
  expect(JSON.stringify(mockStored)).not.toMatch(
    /formValues|synthetic-recipient/
  );
});

it('clears a draft that has no public ancestor', async () => {
  const caller = unsignedCaller(undefined);
  caller.returnContext = undefined;
  await saveNavigationState(caller.returnRoute, undefined, caller.state);
  await clearTransactionNavigationState();
  expect(mockStored).toBeUndefined();
});

it('preserves public browsing on best-effort storage read failure', async () => {
  await saveNavigationState('/settings/about');
  const before = JSON.stringify(mockStored);
  mockGet.mockRejectedValueOnce(new Error('Worker storage unavailable'));
  mockSet.mockClear();
  mockRemove.mockClear();
  await clearTransactionNavigationState();
  expect(JSON.stringify(mockStored)).toBe(before);
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
});

it.each(['new route', 'auth clear'])(
  'local generation prevents delayed cleanup overriding %s',
  async (operation) => {
    await saveNavigationState(
      '/send/eth',
      undefined,
      unsignedCaller().state,
      publicCaller()
    );
    const old = JSON.parse(JSON.stringify(mockStored));
    const reading = deferred<any>();
    mockGet.mockReturnValueOnce(reading.promise);
    const cleanup = clearTransactionNavigationState();
    if (operation === 'new route') await saveNavigationState('/receive');
    else await clearNavigationState();
    reading.resolve(old);
    await cleanup;
    if (operation === 'new route')
      expect(mockStored.currentPath).toBe('/receive');
    else expect(mockStored).toBeUndefined();
  }
);

it.each(['new route', 'auth clear'])(
  'a shared lock serializes separate-document cleanup before %s',
  async (operation) => {
    const locks = sharedLockManager();
    const background = separateDocument();
    await saveNavigationState(
      '/send/eth',
      undefined,
      unsignedCaller().state,
      publicCaller()
    );
    const old = JSON.parse(JSON.stringify(mockStored));
    const reading = deferred<any>();
    mockGet.mockReturnValueOnce(reading.promise);
    const cleanup = background.clearTransactionNavigationState();
    await Promise.resolve();
    await Promise.resolve();
    const next =
      operation === 'new route'
        ? saveNavigationState('/receive')
        : clearNavigationState();
    reading.resolve(old);
    await Promise.all([cleanup, next]);
    if (operation === 'new route')
      expect(mockStored.currentPath).toBe('/receive');
    else expect(mockStored).toBeUndefined();
    expect(locks.getMaxActive()).toBe(1);
    expect(new Set(locks.request.mock.calls.map(([name]) => name)).size).toBe(
      1
    );
  }
);

it('rejects a queued old-account save before stamping another wallet scope', async () => {
  const locks = sharedLockManager();
  const held = deferred<void>();
  const blocker = navigator.locks.request(
    'pali-navigation-storage',
    { mode: 'exclusive' },
    async () => held.promise
  );
  const save = saveNavigationState(
    '/send/eth',
    undefined,
    unsignedCaller().state
  );
  mockState.vault.activeAccount.id = 2;
  held.resolve();
  await Promise.all([blocker, save]);
  expect(mockStored).toBeUndefined();
  expect(mockSet).not.toHaveBeenCalled();
  expect(locks.getMaxActive()).toBe(1);
});

it.each(['read', 'write', 'delete', 'lock'])(
  'strict discard propagates %s failure before an action can proceed',
  async (failure) => {
    const caller = unsignedCaller();
    if (failure === 'delete') caller.returnContext = undefined;
    await saveNavigationState(
      caller.returnRoute,
      undefined,
      caller.state,
      caller.returnContext
    );
    const error = new Error(`Storage ${failure} failed`);
    if (failure === 'read') mockGet.mockRejectedValueOnce(error);
    if (failure === 'write') mockSet.mockRejectedValueOnce(error);
    if (failure === 'delete') mockRemove.mockRejectedValueOnce(error);
    if (failure === 'lock')
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: jest.fn().mockRejectedValue(error) },
      });
    await expect(
      clearTransactionNavigationState({
        requireDiscard: true,
        assertCurrent: () => true,
      })
    ).rejects.toThrow(error);
  }
);

it('strict cleanup permits a queued safe marker projection without canceling its later write', async () => {
  sharedLockManager();
  await saveConfirmationReturnState(reviewState());
  const old = JSON.parse(JSON.stringify(mockStored));
  const reading = deferred<any>();
  mockGet.mockReturnValueOnce(reading.promise);
  const cleanup = clearTransactionNavigationState({
    requireDiscard: true,
    assertCurrent: () => true,
  });
  await Promise.resolve();
  await Promise.resolve();
  const marker = saveConfirmationReturnState(reviewState(true));
  reading.resolve(old);
  await Promise.all([cleanup, marker]);
  expect(mockStored.currentPath).toBe(
    '/settings/account/smart-account-policy?view=modules'
  );
  expect(JSON.stringify(mockStored)).not.toMatch(
    /formValues|synthetic-recipient/
  );
});

it('strict cleanup rejects a real departure and preserves its queued newer destination', async () => {
  sharedLockManager();
  await saveConfirmationReturnState(reviewState());
  const old = JSON.parse(JSON.stringify(mockStored));
  const reading = deferred<any>();
  let current = true;
  mockGet.mockReturnValueOnce(reading.promise);
  const cleanup = clearTransactionNavigationState({
    requireDiscard: true,
    assertCurrent: () => current,
  });
  const rejected = expect(cleanup).rejects.toThrow(
    'Navigation cleanup context changed'
  );
  await Promise.resolve();
  await Promise.resolve();
  current = false;
  const next = saveNavigationState('/receive');
  reading.resolve(old);
  await Promise.all([rejected, next]);
  expect(mockStored.currentPath).toBe('/receive');
});

it('only the latest same-document save writes after waiting behind a shared lock', async () => {
  sharedLockManager();
  const held = deferred<void>();
  const blocker = navigator.locks.request(
    'pali-navigation-storage',
    { mode: 'exclusive' },
    async () => held.promise
  );
  const older = saveNavigationState('/settings/about');
  const newer = saveNavigationState('/receive');
  held.resolve();
  await Promise.all([blocker, older, newer]);
  expect(mockSet).toHaveBeenCalledTimes(1);
  expect(mockStored.currentPath).toBe('/receive');
});

it('a queued auth clear still runs when a newer public save follows it', async () => {
  sharedLockManager();
  const held = deferred<void>();
  const blocker = navigator.locks.request(
    'pali-navigation-storage',
    { mode: 'exclusive' },
    async () => held.promise
  );
  const clear = clearNavigationState();
  const newer = saveNavigationState('/settings/about');
  held.resolve();
  await Promise.all([blocker, clear, newer]);
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(mockStored.currentPath).toBe('/settings/about');
});

it('strict cleanup rejects a queued wallet scope change without touching storage', async () => {
  sharedLockManager();
  await saveConfirmationReturnState(reviewState());
  const before = JSON.stringify(mockStored);
  const held = deferred<void>();
  const blocker = navigator.locks.request(
    'pali-navigation-storage',
    { mode: 'exclusive' },
    async () => held.promise
  );
  const cleanup = clearTransactionNavigationState({
    requireDiscard: true,
    assertCurrent: () => true,
  });
  const rejected = expect(cleanup).rejects.toThrow(
    'Navigation cleanup context changed'
  );
  mockState.vault.activeNetwork.chainId = 2;
  held.resolve();
  await Promise.all([blocker, rejected]);
  expect(JSON.stringify(mockStored)).toBe(before);
});

it('strict cleanup without an ownership callback rejects a newer generation during its read', async () => {
  await saveConfirmationReturnState(reviewState());
  const before = JSON.parse(JSON.stringify(mockStored));
  const reading = deferred<any>();
  mockGet.mockReturnValueOnce(reading.promise);
  const cleanup = clearTransactionNavigationState({ requireDiscard: true });
  const rejected = expect(cleanup).rejects.toThrow(
    'Navigation cleanup context changed'
  );
  await saveNavigationState('/receive');
  reading.resolve(before);
  await rejected;
  expect(mockStored.currentPath).toBe('/receive');
});
