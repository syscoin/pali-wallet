let mockState: any;
let mockController: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: jest.fn((action) => action),
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

import store from 'state/store';
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import {
  assertProviderRequestBudget,
  DAPP_REQUEST_LIMITS,
} from 'utils/requestPayloadBudget';
import { blacklistService } from 'utils/security/blacklistService';

import { onMessage } from './index';
import { popupPromise } from './popup-promise';

const ADDRESS = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'ab'.repeat(20)}`;
const HOST = 'https://watchasset-budget.synthetic.invalid';
const TYPE = KeyringAccountType.HDAccount;
const maximum =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const data = (tokenId: string | number) => ({
  method: 'wallet_watchAsset',
  params: [{ type: 'ERC1155', options: { address: TOKEN, tokenId } }],
});
const request = (tokenId: string | number) =>
  onMessage({ type: 'METHOD_REQUEST', data: data(tokenId) }, {
    url: HOST + '/',
    tab: { id: 50 },
  } as chrome.runtime.MessageSender);

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
    wallet: { isUnlocked: jest.fn(() => true) },
    dapp: {
      isConnected: jest.fn(() => false),
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
  jest
    .spyOn(blacklistService, 'checkUrl')
    .mockResolvedValue({ isBlacklisted: false } as any);
});
afterEach(() => jest.restoreAllMocks());

it.each([
  ['decimal', '9'.repeat(4096)],
  ['hexadecimal', '0x' + 'f'.repeat(4096)],
  ['valid padded value', '0'.repeat(4095) + '7'],
])(
  'rejects repeated oversized %s IDs before native parsing, connection or popup work',
  async (_label, tokenId) => {
    // The generic transport budget still admits these bounded fixture inputs;
    // the uint256 parser applies its own tighter work bound.
    expect(DAPP_REQUEST_LIMITS.bytes).toBe(1024 * 1024);
    expect(() => assertProviderRequestBudget(data(tokenId))).not.toThrow();
    const nativeBigInt = BigInt;
    const integer = jest
      .spyOn(global, 'BigInt')
      .mockImplementation(((value: any) =>
        nativeBigInt(value)) as typeof BigInt);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await request(tokenId)).toEqual({
        error: { code: -32602, message: 'Invalid token id' },
      });
    }
    expect(integer).not.toHaveBeenCalled();
    expect(mockController.dapp.isConnected).not.toHaveBeenCalled();
    expect(mockController.wallet.isUnlocked).not.toHaveBeenCalled();
    expect(popupPromise).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  }
);

it.each([maximum, '0x' + 'f'.repeat(64), '000' + maximum, '0007', 7])(
  'retains the ordinary unconnected approval workflow for valid ID %s',
  async (tokenId) => {
    expect(await request(tokenId)).toBe(true);
    expect(popupPromise).toHaveBeenCalledTimes(2);
    for (const eventName of ['connect', 'wallet_watchAsset'])
      expect(popupPromise).toHaveBeenCalledWith(
        expect.objectContaining({ host: HOST, eventName })
      );
  }
);

it('retains the early blocked-origin check without parsing an oversized token ID', async () => {
  mockState.spamFilter.dapps[HOST] = {
    blockedUntil: Date.now() + 60_000,
    requests: [],
  };
  const nativeBigInt = BigInt;
  const integer = jest
    .spyOn(global, 'BigInt')
    .mockImplementation(((value: any) => nativeBigInt(value)) as typeof BigInt);
  const result = await request('9'.repeat(4096));
  expect(result.error.code).toBe(4100);
  expect(integer).not.toHaveBeenCalled();
  expect(popupPromise).not.toHaveBeenCalled();
});
