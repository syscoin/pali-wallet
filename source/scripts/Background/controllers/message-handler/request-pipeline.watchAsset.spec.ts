let mockState: any;
let mockController: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => {
      mockState = {
        ...mockState,
        vault: jest
          .requireActual('state/vault')
          .default(mockState.vault, action),
      };
      return action;
    },
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

import EthAccountController from '../account/evm';
import store from 'state/store';
import vaultReducer, { rehydrate as rehydrateVault } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import { onMessage } from './index';
import { popupPromise } from './popup-promise';

const ADDRESS = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'ab'.repeat(20)}`;
const HOST = 'https://watchasset.invalid';
const TYPE = KeyringAccountType.HDAccount;
const request = (address = TOKEN) =>
  onMessage(
    {
      type: 'METHOD_REQUEST',
      data: {
        method: 'wallet_watchAsset',
        params: [
          {
            type: 'ERC20',
            options: { address, symbol: 'SYN', decimals: 18 },
          },
        ],
      },
    },
    { url: `${HOST}/`, tab: { id: 50 } } as chrome.runtime.MessageSender
  );

const seedToken = async (chainId: number) => {
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      activeNetwork: { ...mockState.vault.activeNetwork, chainId },
    },
  };
  const prepare = await EthAccountController().prepareTokenAddition({
    contractAddress: TOKEN,
    tokenSymbol: 'SYN',
    tokenStandard: 'ERC-20',
    chainId,
    decimals: 18,
    balance: 1,
  } as any);
  store.dispatch(prepare());
};

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
        url: 'https://rpc.invalid',
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
    spamFilter: { dapps: {} },
  };
  mockController = {
    wallet: { isUnlocked: () => true },
    dapp: {
      isConnected: () => true,
      getAccount: () => mockState.vault.accounts[TYPE][0],
      get: () => ({ accountId: 0, accountType: TYPE, host: HOST }),
    },
  };
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
});

it('treats a token already watched on the current chain as a successful no-op', async () => {
  await seedToken(5700);
  expect(await request(TOKEN.toUpperCase().replace('0X', '0x'))).toBe(true);
  expect(popupPromise).not.toHaveBeenCalled();
});

it('opens the normal approval for an absent token', async () => {
  expect(await request()).toBe(true);
  expect(popupPromise).toHaveBeenCalledTimes(1);
  expect(popupPromise).toHaveBeenCalledWith(
    expect.objectContaining({
      host: HOST,
      eventName: 'wallet_watchAsset',
      data: { asset: expect.objectContaining({ type: 'ERC20' }) },
    })
  );
});

it('does not confuse a saved token on another chain with the selected-chain token', async () => {
  await seedToken(1);
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      activeNetwork: { ...mockState.vault.activeNetwork, chainId: 5700 },
    },
  };
  expect(await request()).toBe(true);
  expect(popupPromise).toHaveBeenCalledTimes(1);
  // This request must reach the ordinary review, not silently mutate tokens.
  expect(mockState.vault.accountAssets[TYPE][0].ethereum).toEqual([
    expect.objectContaining({ contractAddress: TOKEN, chainId: 1 }),
  ]);
});

it('retains a no-op when another-chain token and current-chain token both exist', async () => {
  await seedToken(1);
  await seedToken(5700);
  expect(mockState.vault.accountAssets[TYPE][0].ethereum).toHaveLength(2);
  expect(await request()).toBe(true);
  expect(popupPromise).not.toHaveBeenCalled();
});

it.each([undefined, null, 0, 1])(
  'does not treat a stored token with chainId %s as already watched on the current chain',
  async (chainId) => {
    const otherToken = {
      contractAddress: TOKEN,
      tokenSymbol: 'SYN',
      tokenStandard: 'ERC-20',
      decimals: 18,
      balance: 1,
      chainId,
    };
    // Explicitly construct a malformed or other-chain stored record; normal
    // token saves stamp the active chain before this restoration boundary.
    const persisted = JSON.parse(JSON.stringify(mockState.vault));
    persisted.accountAssets[TYPE][0].ethereum = JSON.parse(
      JSON.stringify([otherToken])
    );
    mockState = {
      ...mockState,
      vault: vaultReducer(mockState.vault, rehydrateVault(persisted)),
    };
    const restored = mockState.vault.accountAssets[TYPE][0].ethereum;
    expect(restored[0].chainId).toBe(chainId);
    expect(await request()).toBe(true);
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(mockState.vault.accountAssets[TYPE][0].ethereum).toBe(restored);
  }
);

it.each([undefined, null, 0, 1])(
  'keeps the current-chain no-op beside a same-address chainId %s record',
  async (chainId) => {
    await seedToken(5700);
    const current = mockState.vault.accountAssets[TYPE][0].ethereum[0];
    const other = { ...current, chainId };
    const records = [other, current];
    mockState = {
      ...mockState,
      vault: {
        ...mockState.vault,
        accountAssets: {
          ...mockState.vault.accountAssets,
          [TYPE]: { 0: { ethereum: records, syscoin: [] } },
        },
      },
    };

    expect(await request()).toBe(true);
    expect(popupPromise).not.toHaveBeenCalled();
    expect(mockState.vault.accountAssets[TYPE][0].ethereum).toBe(records);
    expect(records).toEqual([other, current]);
  }
);
