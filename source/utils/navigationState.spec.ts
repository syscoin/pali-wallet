/** @jest-environment jsdom */
import {
  createBrowsingNavigationContext,
  getWalletNavigationScope,
  loadNavigationState,
  navigateBack,
  safeWalletPath,
  saveNavigationState,
} from './navigationState';

let mockStored: any;
let mockState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('./storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn(async () => mockStored),
    setItem: jest.fn(async (_key, value) => {
      mockStored = value;
    }),
    removeItem: jest.fn(async () => {
      mockStored = undefined;
    }),
  },
}));
const reset = () => {
  mockStored = undefined;
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
