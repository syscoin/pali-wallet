jest.mock('syscoinjs-lib', () => ({
  utils: jest.requireActual('syscoinjs-lib/utils'),
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
let mockState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {},
}));

import SysAssetsController from './assets/syscoin';
import SyscoinBalanceController from './balances/syscoin';
import MainController from './MainController';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

const account = {
  id: 0,
  address: 'unused',
  xpub: 'zpub-summary-probe',
  balances: { syscoin: '0' },
};
const savedAsset = {
  assetGuid: '123',
  chainId: 57,
  balance: '0',
  symbol: 'SAVED',
  decimals: 2,
} as any;
const summary = (includeAsset: boolean) => ({
  address: account.xpub,
  balance: '100000000',
  unconfirmedBalance: '-10000000',
  unconfirmedTxs: 1,
  txs: 3,
  tokensAsset: includeAsset
    ? [
        {
          assetGuid: '123',
          balance: '0',
          decimals: 2,
          symbol: 'WIRE',
          totalReceived: '1000',
          totalSent: '1000',
          transfers: 2,
        },
      ]
    : [],
});
const originalFetch = global.fetch;
beforeEach(() => clearFetchBackendAccountCache());
afterEach(() => {
  clearFetchBackendAccountCache();
  global.fetch = originalFetch;
});

it.each([
  ['https://blockbook.invalid', false],
  ['https://blockbook.invalid/', false],
  ['https://blockbook.invalid', true],
  ['https://blockbook.invalid/', true],
])(
  'shares the ordinary refresh summary for %s (saved SPT=%s)',
  async (url: string, includeAsset: boolean) => {
    const network = { chainId: 57, kind: 'syscoin', currency: 'sys', url };
    mockState = {
      vault: {
        accounts: { HDAccount: { 0: account } },
        activeAccount: { type: 'HDAccount', id: 0 },
        isBitcoinBased: true,
        activeNetwork: network,
        accountTransactions: { HDAccount: { 0: { syscoin: { 57: [] } } } },
      },
      vaultGlobal: { networkStatus: 'idle' },
    };
    const requests: string[] = [];
    global.fetch = jest.fn(async (input) => {
      requests.push(String(input));
      return Response.json(summary(includeAsset));
    });
    let assetRead: Promise<unknown> | undefined;
    let nativeBalance: string | undefined;
    // Retain the normal refresh's start/order behavior with actual host readers and SJS HTTP.
    const controller = Object.assign(Object.create(MainController.prototype), {
      walletSessionGeneration: 0,
      networkRequestGeneration: 0,
      updateAssetsFromCurrentAccount: () =>
        (assetRead = SysAssetsController().getSysAssetsByXpub(
          account.xpub,
          url,
          57,
          includeAsset ? [savedAsset] : []
        )),
      updateUserTransactionsState: async () => undefined,
      updateUserNativeBalance: async () => {
        nativeBalance =
          await SyscoinBalanceController().getSysBalanceForAccount(
            account as any,
            url
          );
      },
    });
    await controller.getLatestUpdateForCurrentAccount(true, true);
    const assets = await assetRead;
    expect(requests).toEqual([
      `https://blockbook.invalid/api/v2/xpub/${account.xpub}?details=tokenBalances&tokens=used`,
    ]);
    expect(nativeBalance).toBe('0.9');
    expect(assets).toEqual(
      includeAsset
        ? [
            expect.objectContaining({
              assetGuid: '123',
              balance: '0.0',
              totalReceived: '10.0',
              totalSent: '10.0',
              transfers: 2,
            }),
          ]
        : []
    );
  }
);

it.each(['native', 'assets'])(
  'keeps the shared summary alive when %s cancels',
  async (cancel) => {
    const native = new AbortController(),
      assets = new AbortController();
    const owner = (controller: AbortController) => ({
      signal: controller.signal,
      assertCurrent() {
        if (controller.signal.aborted)
          throw Object.assign(Error('retired'), { name: 'AbortError' });
      },
    });
    let complete!: (value: Response) => void;
    let physical!: AbortSignal;
    global.fetch = jest.fn(async (_input, init) => {
      physical = init!.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    });
    const nativeRead = SyscoinBalanceController().getSysBalanceForAccount(
      account as any,
      'https://blockbook.invalid',
      owner(native)
    );
    const assetRead = SysAssetsController().getSysAssetsByXpub(
      account.xpub,
      'https://blockbook.invalid/',
      57,
      [savedAsset],
      owner(assets)
    );
    const observedNative = nativeRead.catch((error) => error);
    const observedAssets = assetRead.catch((error) => error);
    const rejected = expect(
      cancel === 'native' ? nativeRead : assetRead
    ).rejects.toHaveProperty('name', 'AbortError');
    (cancel === 'native' ? native : assets).abort();
    await rejected;
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(physical.aborted).toBe(false);
    complete(Response.json(summary(true)));
    if (cancel === 'native')
      expect(await assetRead).toEqual([
        expect.objectContaining({
          balance: '0.0',
          totalReceived: '10.0',
          transfers: 2,
        }),
      ]);
    else expect(await nativeRead).toBe('0.9');
    await Promise.all([observedNative, observedAssets]);
  }
);
