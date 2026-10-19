import { configureStore } from '@reduxjs/toolkit';

import vaultReducer, { setAccountAssets } from 'state/vault';
import { KeyringAccountType } from 'types/network';

import AssetsManager from './assets';
import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

let mockStore: any;
const mockRead = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('syscoinjs-lib', () => ({
  utils: { fetchBackendAccount: (...args: any[]) => mockRead(...args) },
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
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));

const token = {
  assetGuid: '998877',
  chainId: 57,
  symbol: 'SPT',
  decimals: 2,
  balance: '5',
  confirmedBalance: '5',
  unconfirmedBalance: '0',
  totalSent: '1',
  totalReceived: '6',
  transfers: 2,
  type: 'SPTAllocated',
  description: 'Imported description',
  image: 'ipfs://imported-image',
};
const healthyInventory = {
  tokensAsset: [
    {
      assetGuid: token.assetGuid,
      decimals: 2,
      balance: '700',
      totalReceived: '800',
      totalSent: '100',
      transfers: 3,
    },
  ],
};
let controller: any;
const currentToken = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin[0];
const refresh = () =>
  controller.updateAssetsFromCurrentAccount({
    activeAccount: mockStore.getState().vault.activeAccount,
    activeNetwork: mockStore.getState().vault.activeNetwork,
    isBitcoinBased: true,
    isPolling: true,
  });

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  clearFetchBackendAccountCache();
  mockRead.mockReset();
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer },
    preloadedState: {
      vault: {
        ...initial,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        activeNetwork: {
          chainId: 57,
          kind: 'syscoin',
          slip44: 57,
          url: 'https://synthetic-blockbook.invalid/',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: { address: 'sys1qfixture', xpub: 'zpub-fixture' },
          },
        },
        accountAssets: {
          HDAccount: { 0: { ethereum: [], syscoin: [token] } },
        },
      } as any,
    },
  });
  // Retain the actual controller, asset reader, request wrapper and reducer.
  // Replace only external SDK I/O and the unused EVM keyring handle.
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    assetUpdateRequestId: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    targetedBalanceVersions: new Map(),
    cancellablePromises: new CancellablePromises(),
    assetsManager: AssetsManager(),
    getActiveKeyring: () => ({ ethereumTransaction: { web3Provider: {} } }),
  });
});
afterEach(() => {
  clearFetchBackendAccountCache();
  jest.restoreAllMocks();
});

it('commits a valid SPT balance through the real refresh pipeline', async () => {
  mockRead.mockResolvedValue(healthyInventory);
  await refresh();
  expect(mockRead).toHaveBeenCalledWith(
    'https://synthetic-blockbook.invalid/',
    'zpub-fixture',
    'details=tokenBalances&tokens=used',
    true
  );
  expect(currentToken()).toMatchObject({
    balance: '7.0',
    totalSent: '1.0',
    totalReceived: '8.0',
    description: token.description,
    image: token.image,
  });
});

it.each([
  { tokensAsset: [] },
  {
    address: 'zpub-fixture',
    addressOrXpub: 'zpub-fixture',
    balance: '0',
    unconfirmedBalance: '0',
    txs: 0,
    unconfirmedTxs: 0,
  },
  {
    address: 'zpub-fixture',
    balance: 1000,
    unconfirmedBalance: -100,
    txs: '1',
    unconfirmedTxs: '1',
    usedTokens: 1,
    tokens: [{ type: 'XPUBAddress', name: 'sys1qfixture', balance: '1000' }],
  },
])(
  'accepts an empty token inventory from a valid account: %p',
  async (reply) => {
    mockRead.mockResolvedValue(reply);
    await refresh();
    expect(currentToken()).toMatchObject({
      balance: '0',
      totalSent: '0',
      totalReceived: '0',
      transfers: 0,
      description: token.description,
      image: token.image,
    });
  }
);

it.each([{}, { message: 'Temporarily unavailable' }, { balance: '0' }])(
  'preserves SPT state for an incomplete account response without tokens: %p',
  async (reply) => {
    mockRead.mockResolvedValue(reply);
    const failure = await refresh().catch((error: Error) => error);
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(currentToken()).toEqual(token);
    expect(failure).toEqual(
      new Error('SPT token inventory is unavailable or invalid')
    );
  }
);

it.each([
  { address: undefined },
  { balance: undefined },
  { unconfirmedBalance: undefined },
  { txs: undefined },
  { unconfirmedTxs: undefined },
  { balance: 'unavailable' },
  { unconfirmedBalance: [] },
  { txs: -1 },
  { unconfirmedTxs: 1.5 },
])(
  'requires a complete summary when token inventory is omitted: %p',
  async (invalid) => {
    mockRead.mockResolvedValue({
      address: 'zpub-fixture',
      balance: '0',
      unconfirmedBalance: '0',
      txs: 0,
      unconfirmedTxs: 0,
      ...invalid,
    });
    await expect(refresh()).rejects.toThrow(
      'SPT token inventory is unavailable or invalid'
    );
    expect(currentToken()).toEqual(token);
  }
);

it.each([
  null,
  undefined,
  'unavailable',
  [],
  { error: 'backend unavailable' },
  { tokensAsset: {} },
  { tokensAsset: null },
])(
  'preserves SPT balances and metadata on an unusable SDK response: %p',
  async (reply) => {
    mockRead.mockResolvedValue(reply);
    await expect(refresh()).rejects.toThrow(
      'SPT token inventory is unavailable or invalid'
    );
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(currentToken()).toEqual(token);
  }
);

it('accepts the next healthy refresh after a failed read', async () => {
  mockRead.mockResolvedValueOnce(null).mockResolvedValueOnce(healthyInventory);
  await expect(refresh()).rejects.toThrow(
    'SPT token inventory is unavailable or invalid'
  );
  expect(currentToken()).toEqual(token);
  // Begin a new transport request rather than joining its short-lived cache.
  clearFetchBackendAccountCache();
  await refresh();
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(currentToken()).toMatchObject({
    balance: '7.0',
    totalSent: '1.0',
    totalReceived: '8.0',
    description: token.description,
    image: token.image,
  });
});

it('preserves the entire imported inventory after mixed valid and unidentified rows', async () => {
  const secondToken = { ...token, assetGuid: '445566', balance: '9' };
  const original = [token, secondToken];
  mockStore.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      assets: { syscoin: original, ethereum: [] },
    })
  );
  mockRead.mockResolvedValue({
    tokensAsset: [...healthyInventory.tokensAsset, { balance: '900' }],
  });
  const failure = await refresh().catch((error: Error) => error);
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockStore.getState().vault.accountAssets.HDAccount[0].syscoin).toEqual(
    original
  );
  expect(failure).toEqual(
    new Error('SPT token inventory is unavailable or invalid')
  );
});

it.each([
  null,
  [],
  '998877',
  {},
  { assetGuid: null },
  { assetGuid: '' },
  { assetGuid: 'not-a-guid' },
  { assetGuid: -1 },
  { assetGuid: 1.5 },
  { assetGuid: Number.MAX_SAFE_INTEGER + 1 },
])('preserves balances on a malformed inventory row: %p', async (row) => {
  mockRead.mockResolvedValue({ tokensAsset: [row] });
  await expect(refresh()).rejects.toThrow(
    'SPT token inventory is unavailable or invalid'
  );
  expect(currentToken()).toEqual(token);
});

it.each(['998877', 998877, '18446744073709551615'])(
  'accepts a usable string or numeric GUID without losing its identity: %p',
  async (assetGuid) => {
    const imported = { ...token, assetGuid: String(assetGuid) };
    mockStore.dispatch(
      setAccountAssets({
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        assets: { syscoin: [imported], ethereum: [] },
      })
    );
    mockRead.mockResolvedValue({
      tokensAsset: [{ ...healthyInventory.tokensAsset[0], assetGuid }],
    });
    await refresh();
    expect(currentToken()).toMatchObject({
      assetGuid: String(assetGuid),
      balance: '7.0',
      totalSent: '1.0',
      totalReceived: '8.0',
      description: token.description,
      image: token.image,
    });
  }
);
