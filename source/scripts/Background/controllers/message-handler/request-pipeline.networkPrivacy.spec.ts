import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { clearRpcCaches, getEthRpc } from '@sidhujag/sysweb3-network';

import DAppController from '../DAppController';
import dapp from 'state/dapp';
import spamFilter from 'state/spamFilter';
import vault, { setNetworkChange } from 'state/vault';
import vaultGlobal, { setActiveSlip44, setNetworks } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import { onMessage } from './index';
import { popupPromise } from './popup-promise';
import { clearProviderCache } from './provider-cache';

let mockStore: any;
let mockController: any;
let unlocked: boolean;
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
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

const HOST = 'https://unconnected.synthetic.invalid';
const API_URL =
  'https://explorer.synthetic.invalid/api?apikey=synthetic-secret';
const cases = [
  ['wallet_getNetwork', INetworkType.Ethereum],
  ['wallet_getNetwork', INetworkType.Syscoin],
  ['sys_getNetwork', INetworkType.Syscoin],
] as const;
const request = (method: string) =>
  onMessage({ type: 'METHOD_REQUEST', data: { method, params: [] } }, {
    url: `${HOST}/page`,
    tab: { id: 8 },
  } as chrome.runtime.MessageSender);
const select = (network: INetwork) => {
  mockStore.dispatch(
    setNetworks({
      ethereum: {},
      syscoin: {},
      [network.kind]: { [network.chainId]: network },
    })
  );
  mockStore.dispatch(setNetworkChange({ activeNetwork: network }));
  mockStore.dispatch(setActiveSlip44(network.slip44));
};
const networkFor = (kind: INetworkType): INetwork => ({
  kind,
  chainId: kind === INetworkType.Ethereum ? 31337 : 57,
  slip44: kind === INetworkType.Ethereum ? 60 : 57,
  label: 'Synthetic custom network',
  currency: kind === INetworkType.Ethereum ? 'eth' : 'sys',
  url: 'https://public.synthetic.invalid/rpc',
  explorer: 'https://public-explorer.synthetic.invalid/',
  key: 'synthetic-network-identity',
  default: false,
  coingeckoId: 'synthetic-coin',
  coingeckoPlatformId: 'synthetic-platform',
});

beforeEach(() => {
  jest.clearAllMocks();
  clearProviderCache();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('Public network reads must not fetch');
  });
  clearRpcCaches();
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
  mockStore = configureStore({
    reducer: combineReducers({ vault, vaultGlobal, dapp, spamFilter }),
  });
  unlocked = false;
  mockController = {
    wallet: { isUnlocked: () => unlocked },
    dapp: DAppController(() => unlocked),
  };
});
afterEach(() => jest.restoreAllMocks());

describe.each([false, true])(
  'unconnected public reads, unlocked=%s',
  (isUnlocked) => {
    beforeEach(() => {
      unlocked = isUnlocked;
    });

    it.each(cases)(
      '%s omits only the private API URL on %s',
      async (method, kind) => {
        const network = { ...networkFor(kind), apiUrl: API_URL };
        select(network);
        const before = mockStore.getState();
        const expected = networkFor(kind);
        expect(mockController.dapp.isConnected(HOST)).toBe(false);

        const result = await request(method);

        expect(result).toEqual(expected);
        expect(result).not.toHaveProperty('apiUrl');
        expect(JSON.stringify(result)).not.toContain('synthetic-secret');
        expect(mockStore.getState()).toBe(before);
        expect(before.vault.activeNetwork).toEqual(network);
        expect(before.vaultGlobal.networks[kind][network.chainId]).toEqual(
          network
        );
        expect(popupPromise).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      }
    );
  }
);

it.each(cases)(
  '%s preserves a network without private API configuration on %s',
  async (method, kind) => {
    const network = networkFor(kind);
    select(network);
    expect(await request(method)).toEqual(network);
    expect(mockStore.getState().vault.activeNetwork).toEqual(network);
    expect(popupPromise).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
);

it('projects the real custom-RPC producer without exposing its explorer API key', async () => {
  const rpcUrl = 'https://public.synthetic.invalid/producer-rpc';
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x7a69' }),
  } as Response);
  // Keep the installed producer real; replace only its external chain-ID I/O.
  const { formattedNetwork } = await getEthRpc(
    {
      url: rpcUrl,
      apiUrl: API_URL,
      label: 'Synthetic custom network',
      symbol: 'ETH',
      explorer: 'https://public-explorer.synthetic.invalid/',
    },
    false
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    rpcUrl,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    })
  );
  expect(formattedNetwork.apiUrl).toBe(API_URL);
  select(formattedNetwork);
  const before = mockStore.getState();

  const result = await request('wallet_getNetwork');

  expect(result).toEqual({
    url: rpcUrl,
    default: false,
    label: 'Synthetic custom network',
    explorer: 'https://public-explorer.synthetic.invalid/',
    currency: 'eth',
    chainId: 31337,
    slip44: 60,
    kind: INetworkType.Ethereum,
  });
  expect(result).not.toHaveProperty('apiUrl');
  expect(mockStore.getState()).toBe(before);
  expect(before.vault.activeNetwork.apiUrl).toBe(API_URL);
  expect(popupPromise).not.toHaveBeenCalled();
});

it.each([
  ['wallet_getProviderState', INetworkType.Ethereum],
  ['wallet_getSysProviderState', INetworkType.Syscoin],
] as const)(
  '%s keeps the existing public initialization contract on %s',
  async (method, kind) => {
    const network = { ...networkFor(kind), apiUrl: API_URL };
    select(network);
    const result = await request(method);
    expect(result).toMatchObject({ accounts: [], isUnlocked: false });
    expect(result).not.toHaveProperty('apiUrl');
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    if (kind === INetworkType.Syscoin) {
      expect(result.blockExplorerURL).toBe(network.url);
    } else {
      expect(result.chainId).toBe('0x7a69');
    }
    expect(mockStore.getState().vault.activeNetwork.apiUrl).toBe(API_URL);
    expect(popupPromise).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
);
