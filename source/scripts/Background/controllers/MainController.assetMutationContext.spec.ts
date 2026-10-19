jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyTransaction: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import axios from 'axios';

import { handleMasterControllerResponses } from '../handlers/handleMasterControllerResponses';
import store from 'state/store';
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

import EthAccountController from './account/evm';
import SysAccountController from './account/syscoin';
import MainController from './MainController';

const TYPE = KeyringAccountType.HDAccount;
const TOKEN = `0x${'33'.repeat(20)}`;
const evmAsset = {
  contractAddress: TOKEN,
  tokenSymbol: 'TOKEN',
  decimals: 6,
  balance: 10,
  chainId: 5700,
  tokenStandard: 'ERC-20',
  isNft: false,
};
const sptAsset = {
  assetGuid: '123457',
  symbol: 'TOKEN',
  decimals: 8,
  balance: 10,
  chainId: 5700,
  type: 'SPTAllocated',
};
let state: any;
let wallet: any;

beforeEach(() => {
  const initial = vaultReducer(undefined, { type: '@@init' });
  state = {
    vault: {
      ...initial,
      isBitcoinBased: false,
      activeAccount: { id: 0, type: TYPE },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 5700,
        url: 'https://rpc.invalid/',
        slip44: 60,
      },
      accounts: {
        ...initial.accounts,
        [TYPE]: {
          0: { id: 0, address: `0x${'11'.repeat(20)}`, xpub: 'public-a' },
          1: { id: 1, address: `0x${'22'.repeat(20)}`, xpub: 'public-b' },
        },
      },
      accountAssets: {
        ...initial.accountAssets,
        [TYPE]: {
          0: { ethereum: [evmAsset], syscoin: [sptAsset] },
          1: { ethereum: [evmAsset], syscoin: [sptAsset] },
        },
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  jest.spyOn(store, 'getState').mockImplementation(() => state);
  jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
    state = { ...state, vault: vaultReducer(state.vault, action) };
    return action;
  });
  jest.spyOn(console, 'error').mockImplementation();
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.isUnlocked = jest.fn(() => true);
  wallet.account = {
    eth: EthAccountController(),
    sys: SysAccountController(() => ({} as any)),
  };
  wallet.saveWalletState = jest.fn().mockResolvedValue(undefined);
  wallet.saveTokenInfo = wallet.saveTokenInfo.bind(wallet);
  wallet.deleteTokenInfo = wallet.deleteTokenInfo.bind(wallet);
});
afterEach(() => jest.restoreAllMocks());

const change = (field: string) => {
  state = JSON.parse(JSON.stringify(state));
  if (field === 'account') state.vault.activeAccount.id = 1;
  if (field === 'address') state.vault.accounts[TYPE][0].address = 'other';
  if (field === 'xpub') state.vault.accounts[TYPE][0].xpub = 'other';
  if (field === 'chain') state.vault.activeNetwork.chainId = 1;
  if (field === 'RPC') state.vault.activeNetwork.url = 'https://other.invalid';
  if (field === 'API') state.vault.activeNetwork.apiUrl = 'https://api.invalid';
  if (field === 'kind')
    state.vault.activeNetwork.kind =
      state.vault.activeNetwork.kind === INetworkType.Syscoin
        ? INetworkType.Ethereum
        : INetworkType.Syscoin;
  if (field === 'slip44') state.vaultGlobal.activeSlip44 = 57;
  if (field === 'switch') state.vaultGlobal.isSwitchingAccount = true;
  if (field === 'connecting') state.vaultGlobal.networkStatus = 'connecting';
  if (field === 'setup') wallet.isCreatingWallet = true;
  if (field === 'lock') wallet.isUnlocked.mockReturnValue(false);
};

describe.each(['ethereum', 'syscoin'])(
  '%s asset mutation context',
  (family) => {
    const prepare = () => {
      if (family === 'syscoin') {
        state.vault.isBitcoinBased = true;
        state.vault.activeNetwork.kind = INetworkType.Syscoin;
      }
    };
    const token = () => (family === 'ethereum' ? evmAsset : sptAsset);
    const tokenKey = () => (family === 'ethereum' ? TOKEN : '123457');
    const assets = (id: number) => state.vault.accountAssets[TYPE][id][family];

    it('imports and removes the intended asset while its context remains current', async () => {
      prepare();
      state.vault.accountAssets[TYPE][0][family] = [];
      const scope = getWalletNavigationScope();
      await wallet.saveTokenInfo(token(), scope);
      expect(assets(0)).toHaveLength(1);
      await wallet.deleteTokenInfo(tokenKey(), 5700, undefined, scope);
      expect(assets(0)).toEqual([]);
      expect(assets(1)).toHaveLength(1);
      expect(wallet.saveWalletState).toHaveBeenNthCalledWith(
        1,
        'add-token',
        true,
        true
      );
      expect(wallet.saveWalletState).toHaveBeenNthCalledWith(
        2,
        'delete-token',
        true,
        true
      );
    });

    it.each([
      'account',
      'address',
      'xpub',
      'chain',
      'RPC',
      'API',
      'kind',
      'slip44',
      'switch',
      'connecting',
      'setup',
      'lock',
    ])(
      'rejects delivered import and removal after %s changes',
      async (field) => {
        prepare();
        const scope = getWalletNavigationScope();
        change(field);
        const before = JSON.stringify(state);
        await expect(wallet.saveTokenInfo(token(), scope)).rejects.toThrow(
          'Asset context changed'
        );
        await expect(
          wallet.deleteTokenInfo(tokenKey(), 5700, undefined, scope)
        ).rejects.toThrow('Asset context changed');
        expect(JSON.stringify(state)).toBe(before);
        expect(store.dispatch).not.toHaveBeenCalled();
        expect(wallet.saveWalletState).not.toHaveBeenCalled();
      }
    );

    it.each([undefined, null, {}, { account: 'invalid', network: 'invalid' }])(
      'rejects missing or malformed scope %j instead of choosing the current account',
      async (scope) => {
        prepare();
        await expect(wallet.saveTokenInfo(token(), scope)).rejects.toThrow(
          'Asset context changed'
        );
        await expect(
          wallet.deleteTokenInfo(tokenKey(), 5700, undefined, scope)
        ).rejects.toThrow('Asset context changed');
        expect(store.dispatch).not.toHaveBeenCalled();
      }
    );

    it('refuses a token or deletion chain that differs from the reviewed network', async () => {
      prepare();
      const scope = getWalletNavigationScope();
      await expect(
        wallet.saveTokenInfo({ ...token(), chainId: 1 }, scope)
      ).rejects.toThrow('Asset network changed');
      await expect(
        wallet.deleteTokenInfo(tokenKey(), 1, undefined, scope)
      ).rejects.toThrow('Asset network changed');
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    });
  }
);

it('rejects an already queued removal delivered after an account change', async () => {
  Object.assign(chrome.runtime, {
    getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
    id: 'pali-extension',
  });
  handleMasterControllerResponses({ wallet } as any);
  const add = chrome.runtime.onMessage.addListener as jest.Mock;
  const listener = add.mock.calls[add.mock.calls.length - 1][0];
  const scope = getWalletNavigationScope();
  const response = new Promise((resolve) => {
    listener(
      {
        type: 'CONTROLLER_ACTION',
        data: {
          methods: ['wallet', 'deleteTokenInfo'],
          params: [TOKEN, 5700, undefined, scope],
        },
      },
      {
        id: 'pali-extension',
        url: 'chrome-extension://pali-extension/app.html',
      },
      resolve
    );
  });
  change('account');
  await expect(response).resolves.toMatchObject({
    success: false,
    error: 'Asset context changed. Please try again.',
  });
  expect(state.vault.accountAssets[TYPE][0].ethereum).toHaveLength(1);
  expect(state.vault.accountAssets[TYPE][1].ethereum).toHaveLength(1);
  expect(store.dispatch).not.toHaveBeenCalled();
});

it('rechecks an SPT import after optional metadata awaits before dispatching', async () => {
  state.vault.isBitcoinBased = true;
  state.vault.activeNetwork.kind = INetworkType.Syscoin;
  let finish!: (value: unknown) => void;
  jest.spyOn(axios, 'get').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const importing = wallet.saveTokenInfo(
    {
      ...sptAsset,
      assetGuid: '123458',
      description: 'https://ipfs.io/ipfs/synthetic',
    },
    getWalletNavigationScope()
  );
  const rejected = expect(importing).rejects.toThrow('Asset context changed');
  change('slip44');
  finish({ data: { image: 'https://image.invalid' } });
  await rejected;
  expect(store.dispatch).not.toHaveBeenCalled();
  expect(wallet.saveWalletState).not.toHaveBeenCalled();
});

describe('SPT imports with delayed metadata', () => {
  let finish: (value: unknown) => void;
  const token = (assetGuid: string, metadata = false) => ({
    ...sptAsset,
    assetGuid,
    ...(metadata && { description: 'https://ipfs.io/ipfs/synthetic' }),
  });
  const guids = () =>
    state.vault.accountAssets[TYPE][0].syscoin.map(
      (asset: any) => asset.assetGuid
    );
  beforeEach(() => {
    state.vault.isBitcoinBased = true;
    state.vault.activeNetwork.kind = INetworkType.Syscoin;
    jest.spyOn(axios, 'get').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  });

  it('retains sequential additions after a healthy metadata response', async () => {
    const scope = getWalletNavigationScope();
    const first = wallet.saveTokenInfo(token('first', true), scope);
    finish({ data: { image: 'https://image.invalid' } });
    await first;
    await wallet.saveTokenInfo(token('second'), scope);
    expect(guids()).toEqual(['123457', 'first', 'second']);
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(2);
  });

  it('preserves a newer addition when earlier metadata completes', async () => {
    const scope = getWalletNavigationScope();
    const first = wallet.saveTokenInfo(token('first', true), scope);
    await wallet.saveTokenInfo(token('second'), scope);
    finish({ data: {} });
    await first;
    expect(getWalletNavigationScope()).toEqual(scope);
    expect(guids()).toEqual(['123457', 'second', 'first']);
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect an asset removed while metadata was pending', async () => {
    const scope = getWalletNavigationScope();
    const first = wallet.saveTokenInfo(token('first', true), scope);
    await wallet.deleteTokenInfo('123457', 5700, undefined, scope);
    finish({ data: {} });
    await first;
    expect(getWalletNavigationScope()).toEqual(scope);
    expect(guids()).toEqual(['first']);
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(2);
  });

  it('rejects a duplicate imported while the original metadata was pending', async () => {
    const scope = getWalletNavigationScope();
    const first = wallet.saveTokenInfo(token('same', true), scope);
    const rejected = expect(first).rejects.toThrow('Token already exists');
    await wallet.saveTokenInfo(token('same'), scope);
    finish({ data: {} });
    await rejected;
    expect(guids()).toEqual(['123457', 'same']);
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(1);
  });
});
