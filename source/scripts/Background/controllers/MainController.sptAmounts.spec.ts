import { configureStore } from '@reduxjs/toolkit';

import vaultReducer from 'state/vault';
import { KeyringAccountType } from 'types/network';

import AssetsManager from './assets';
import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

let mockStore: any;
// Exercise the installed SDK reader, including real JSON response parsing.
jest.unmock('syscoinjs-lib');
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
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
  description: 'Imported metadata',
};
const healthyRow = {
  assetGuid: token.assetGuid,
  decimals: 2,
  balance: '700',
  totalReceived: '800',
  totalSent: '100',
  transfers: 3,
};
let controller: any;
let fetchSpy: jest.SpyInstance;
const currentToken = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin[0];
const refresh = () =>
  controller.updateAssetsFromCurrentAccount({
    activeAccount: mockStore.getState().vault.activeAccount,
    activeNetwork: mockStore.getState().vault.activeNetwork,
    isBitcoinBased: true,
    isPolling: true,
  });
const reply = (...rows: any[]) =>
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => JSON.parse(JSON.stringify({ tokensAsset: rows })),
  });

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  clearFetchBackendAccountCache();
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Unexpected transport call');
  });
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

it('reads a healthy SPT inventory through the installed SDK and real reducer', async () => {
  reply(healthyRow);
  await refresh();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy).toHaveBeenCalledWith(
    'https://synthetic-blockbook.invalid/api/v2/xpub/zpub-fixture?details=tokenBalances&tokens=used'
  );
  expect(currentToken()).toMatchObject({
    balance: '7.0',
    decimals: 2,
    totalReceived: '8.0',
    transfers: 3,
    description: token.description,
  });
});

it('accepts omitted optional counters and unconfirmed delta', async () => {
  reply({ assetGuid: token.assetGuid, decimals: 2, balance: '700' });
  await refresh();
  expect(currentToken()).toMatchObject({
    balance: '7.0',
    totalSent: '0.0',
    totalReceived: '0.0',
    transfers: 0,
    unconfirmedBalance: '0.0',
  });
});

it.each(['0', 0])('accepts an actual zero balance %p', async (balance) => {
  reply({ ...healthyRow, balance });
  await refresh();
  expect(currentToken()).toMatchObject({
    balance: '0.0',
    confirmedBalance: '0.0',
  });
});

it('keeps large integer strings exact and accepts zero asset precision', async () => {
  reply({ ...healthyRow, balance: '9007199254740993', decimals: 0 });
  await refresh();
  expect(currentToken()).toMatchObject({ balance: '9007199254740993' });
});

it('keeps large integer strings exact with eight asset decimals', async () => {
  reply({ ...healthyRow, balance: '9007199254740993', decimals: 8 });
  await refresh();
  expect(currentToken()).toMatchObject({ balance: '90071992.54740993' });
});

it('accepts safe numeric amounts and a negative unconfirmed delta', async () => {
  reply({
    ...healthyRow,
    balance: 100,
    unconfirmedBalance: -50,
    totalSent: 0,
    totalReceived: 100,
  });
  await refresh();
  expect(currentToken()).toMatchObject({
    balance: '0.5',
    confirmedBalance: '1.0',
    unconfirmedBalance: '-0.5',
    totalSent: '0.0',
    totalReceived: '1.0',
  });
});

it.each([3, '3'])(
  'normalizes and sums a valid transfer count %p across matching rows',
  async (transfers) => {
    reply({ ...healthyRow, transfers }, { ...healthyRow, transfers: 4 });
    await refresh();
    expect(currentToken()).toMatchObject({ balance: '14.0', transfers: 7 });
  }
);

it.each([
  ['missing balance', { balance: undefined }],
  ['null balance', { balance: null }],
  ['empty balance', { balance: '' }],
  ['negative confirmed balance', { balance: '-700' }],
  ['unsafe numeric balance', { balance: Number.MAX_SAFE_INTEGER + 1 }],
  ['missing decimals', { decimals: undefined }],
  ['null decimals', { decimals: null }],
  ['negative decimals', { decimals: -1 }],
  ['fractional decimals', { decimals: 1.5 }],
  ['string decimals', { decimals: '2' }],
  ['null unconfirmed delta', { unconfirmedBalance: null }],
  ['empty unconfirmed delta', { unconfirmedBalance: '' }],
  ['unsafe numeric delta', { unconfirmedBalance: Number.MAX_SAFE_INTEGER + 1 }],
  ['null total received', { totalReceived: null }],
  ['negative total received', { totalReceived: '-800' }],
  ['negative total sent', { totalSent: '-100' }],
  ['unsafe numeric sent total', { totalSent: Number.MAX_SAFE_INTEGER + 1 }],
  ['null transfers', { transfers: null }],
  ['negative transfers', { transfers: -3 }],
  ['fractional transfers', { transfers: 1.5 }],
  ['unsafe transfers', { transfers: Number.MAX_SAFE_INTEGER + 1 }],
])(
  'preserves the persisted token after malformed %s',
  async (_label, invalid) => {
    reply({ ...healthyRow, ...invalid });
    const error = await refresh().catch((caught: Error) => caught);
    expect({ failed: Boolean(error), token: currentToken() }).toEqual({
      failed: true,
      token,
    });
  }
);

it('preserves the token when matching rows disagree about asset precision', async () => {
  reply(healthyRow, { ...healthyRow, decimals: 3 });
  const error = await refresh().catch((caught: Error) => caught);
  expect({ failed: Boolean(error), token: currentToken() }).toEqual({
    failed: true,
    token,
  });
});

it('preserves the token when the aggregate transfer count is unsafe', async () => {
  reply(
    { ...healthyRow, transfers: Number.MAX_SAFE_INTEGER },
    { ...healthyRow, transfers: 1 }
  );
  const error = await refresh().catch((caught: Error) => caught);
  expect({ failed: Boolean(error), token: currentToken() }).toEqual({
    failed: true,
    token,
  });
});
