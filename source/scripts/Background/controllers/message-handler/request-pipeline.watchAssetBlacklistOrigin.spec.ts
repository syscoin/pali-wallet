let mockState: any;
let mockController: any;
const mockFetchList = jest.fn<Promise<any>, [string]>();

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: () => ({ get: mockFetchList }) },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => action,
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
}));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock('./popup-promise', () => ({
  popupPromise: jest.fn(async () => true),
}));

import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getDappOrigin } from 'utils/dappOrigin';
import { blacklistService } from 'utils/security/blacklistService';

import { onMessage } from './index';
import { popupPromise } from './popup-promise';

const TYPE = KeyringAccountType.HDAccount;
const ADDRESS = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'ab'.repeat(20)}`;
const LISTED_DOMAIN = 'listed-watchasset.synthetic.invalid';
const KNOWN_LOCAL_DOMAIN = 'metmask.com';
const SAFE_DOMAIN = 'ordinary-watchasset.synthetic.invalid';

const request = (origin: string) =>
  onMessage(
    {
      type: 'METHOD_REQUEST',
      data: {
        method: 'wallet_watchAsset',
        params: [{ type: 'ERC20', options: { address: TOKEN, decimals: 18 } }],
      },
    },
    {
      url: `${origin}/watchasset`,
      tab: { id: 50 },
    } as chrome.runtime.MessageSender
  );

beforeAll(async () => {
  mockFetchList.mockImplementation(async (url) => ({
    data: url.endsWith('urls-darklist.json')
      ? [{ id: LISTED_DOMAIN, comment: 'Synthetic listed domain' }]
      : [],
  }));
  await blacklistService.initialize();
  expect(mockFetchList).toHaveBeenCalledTimes(5);
  expect(blacklistService.isDataLoaded()).toBe(true);
});

beforeEach(() => {
  jest.clearAllMocks();
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockState = {
    vault: {
      ...initial,
      isBitcoinBased: false,
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 5700,
        url: 'https://rpc.synthetic.invalid',
        slip44: 60,
      },
      activeAccount: { id: 0, type: TYPE },
      accounts: {
        ...initial.accounts,
        [TYPE]: { 0: { id: 0, address: ADDRESS } },
      },
      accountAssets: {
        ...initial.accountAssets,
        [TYPE]: { 0: { ethereum: [], syscoin: [] } },
      },
    },
    vaultGlobal: { networkStatus: 'idle' },
    spamFilter: { config: { enabled: false }, dapps: {} },
  };
  mockController = {
    wallet: { isUnlocked: () => true },
    dapp: {
      isConnected: () => false,
      getAccount: () => mockState.vault.accounts[TYPE][0],
      get: () => null,
    },
  };
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

it.each([
  `https://${SAFE_DOMAIN}`,
  `https://${SAFE_DOMAIN}:8443`,
  `http://${SAFE_DOMAIN}:8080`,
  `https://${LISTED_DOMAIN}.attacker.invalid:8443`,
])(
  'keeps the distinct safe permission origin %s through both approvals',
  async (origin) => {
    await expect(request(origin)).resolves.toBe(true);
    expect(popupPromise).toHaveBeenCalledTimes(2);
    for (const eventName of ['connect', 'wallet_watchAsset']) {
      expect(popupPromise).toHaveBeenCalledWith(
        expect.objectContaining({ host: origin, eventName })
      );
    }
  }
);

it.each([
  `https://${LISTED_DOMAIN}`,
  `https://${KNOWN_LOCAL_DOMAIN}`,
  `https://${LISTED_DOMAIN}:8443`,
  `https://${LISTED_DOMAIN}.`,
  `https://sub.${LISTED_DOMAIN}:8443`,
  `https://${KNOWN_LOCAL_DOMAIN}:8443`,
  `https://${KNOWN_LOCAL_DOMAIN}.`,
])('blocks the listed hostname in %s before any approval', async (origin) => {
  // The permission identity stays unchanged; domain matching is separate.
  expect(getDappOrigin(`${origin}/watchasset`)).toBe(origin);
  await expect(request(origin)).resolves.toEqual({
    error: {
      code: 4100,
      message: expect.stringContaining('Connection blocked:'),
    },
  });
  expect(popupPromise).not.toHaveBeenCalled();
});
