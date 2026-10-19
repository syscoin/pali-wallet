import { combineReducers, configureStore } from '@reduxjs/toolkit';

import dappReducer from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer, { setActiveNetwork } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { onMessage } from './index';
import { WalletMethodHandler } from './method-handlers';
import { getMethodConfig } from './method-registry';
import { popupPromise } from './popup-promise';
import { MethodRoute } from './types';

let mockStore: any;
let mockController: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

const HOST = 'https://network-switch.invalid';
const target = {
  kind: INetworkType.Ethereum,
  chainId: 57,
  url: 'https://evm.invalid',
  slip44: 60,
  label: 'EVM 57',
};
const paramsFor = (method: string) => [
  {
    chainId: '0x39',
    ...(method === 'wallet_addEthereumChain'
      ? { rpcUrls: [target.url], chainName: target.label }
      : {}),
  },
];
const request = (method = 'wallet_switchEthereumChain') =>
  onMessage(
    { type: 'METHOD_REQUEST', data: { method, params: paramsFor(method) } },
    { url: `${HOST}/dapp`, tab: { id: 100 } } as any
  );

function setup(kind: INetworkType, chainId = 57, hasTarget = true) {
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  const type = KeyringAccountType.HDAccount;
  mockStore = configureStore({
    reducer: combineReducers({
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      dapp: dappReducer,
      spamFilter: spamFilterReducer,
    }),
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: kind === INetworkType.Syscoin,
        activeNetwork: { ...target, kind, chainId },
        activeAccount: { id: 0, type },
        accounts: {
          ...vault.accounts,
          [type]: {
            0: {
              id: 0,
              address: 'sys1synthetic',
              xpub: 'synthetic',
              label: 'Synthetic',
            },
          },
        },
      },
      vaultGlobal: {
        ...global,
        networkStatus: 'idle',
        activeSlip44: 57,
        networks: {
          ...global.networks,
          ethereum: hasTarget ? { 57: target } : {},
        },
      },
      dapp: { dapps: {} },
      spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  mockController = {
    wallet: { isUnlocked: () => true },
    dapp: { isConnected: () => false, getAccount: () => null },
  };
  jest.mocked(popupPromise).mockImplementation(async (popup) => {
    if (popup.route === MethodRoute.SwitchEthChain) {
      expect(popup.data).toEqual({ chainId: 57 });
      mockStore.dispatch(setActiveNetwork(target as any));
    } else {
      expect(popup.route).toBe(MethodRoute.AddEthChain);
      expect(popup.data).toEqual({
        chainConfig: paramsFor('wallet_addEthereumChain')[0],
      });
    }
    return null;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
});
afterEach(() => jest.restoreAllMocks());

it('does not prompt to switch the already active EVM chain', async () => {
  setup(INetworkType.Ethereum);
  await expect(request()).resolves.toBeNull();
  expect(popupPromise).not.toHaveBeenCalled();
});

it('switches from a different-ID UTXO network to the requested EVM chain', async () => {
  setup(INetworkType.Syscoin, 5700);
  await expect(request()).resolves.toBeNull();
  expect(popupPromise).toHaveBeenCalledTimes(1);
  expect(mockStore.getState().vault.activeNetwork.kind).toBe(
    INetworkType.Ethereum
  );
});

it('switches from a same-ID UTXO network to the requested EVM chain', async () => {
  setup(INetworkType.Syscoin);
  await expect(request()).resolves.toBeNull();
  expect(popupPromise).toHaveBeenCalledTimes(1);
  expect(mockStore.getState().vault.activeNetwork.kind).toBe(
    INetworkType.Ethereum
  );
});

it('rejects an absent EVM network even if a UTXO network shares its ID', async () => {
  setup(INetworkType.Syscoin, 57, false);
  await expect(request()).resolves.toMatchObject({ error: { code: 4902 } });
  expect(popupPromise).not.toHaveBeenCalled();
});

it('the terminal handler also distinguishes a same-ID UTXO network', async () => {
  setup(INetworkType.Syscoin);
  const method = 'wallet_switchEthereumChain';
  await expect(
    new WalletMethodHandler().handle({
      originalRequest: { host: HOST, method, params: paramsFor(method) },
      methodConfig: getMethodConfig(method),
    } as any)
  ).resolves.toBeNull();
  expect(popupPromise).toHaveBeenCalledTimes(1);
});

it('offers to add a missing EVM network whose ID matches the active UTXO network', async () => {
  setup(INetworkType.Syscoin, 57, false);
  await expect(request('wallet_addEthereumChain')).resolves.toBeNull();
  expect(popupPromise).toHaveBeenCalledTimes(1);
  expect(jest.mocked(popupPromise).mock.calls[0][0].route).toBe(
    MethodRoute.AddEthChain
  );
});

it.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  'does not re-add an existing EVM network while on %s',
  async (kind) => {
    setup(kind);
    await expect(request('wallet_addEthereumChain')).resolves.toBeNull();
    expect(popupPromise).not.toHaveBeenCalled();
  }
);

it('offers to add a missing EVM network from a different-ID UTXO network', async () => {
  setup(INetworkType.Syscoin, 5700, false);
  await expect(request('wallet_addEthereumChain')).resolves.toBeNull();
  expect(popupPromise).toHaveBeenCalledTimes(1);
});
