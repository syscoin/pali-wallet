/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { clearRpcCaches } from '@sidhujag/sysweb3-network';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';

import MainController from 'scripts/Background/controllers/MainController';
import EvmTransactionsController from 'scripts/Background/controllers/transactions/evm';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setNetworks } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import CustomRPC from './CustomRPC';
import { clearCustomRpcDrafts } from './customRpcDraft';

jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: true }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <span>Pending</span>,
}));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, description }: any) =>
    show ? <div role="alert">{description}</div> : null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Tooltip: ({ children }: any) => children,
}));

const source: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Active synthetic chain',
  currency: 'eth',
  url: 'https://active.api-selection.synthetic.invalid',
};
const chains = [
  {
    name: 'Selection Alpha',
    chain: INetworkType.Ethereum,
    chainId: 31337,
    nativeCurrency: { symbol: 'ALPHA' },
    rpc: [{ url: 'https://rpc-alpha.api-selection.synthetic.invalid' }],
    explorers: [{ url: 'https://alpha.api-selection.synthetic.invalid' }],
  },
  {
    name: 'Selection Beta',
    chain: INetworkType.Ethereum,
    chainId: 31338,
    nativeCurrency: { symbol: 'BETA' },
    rpc: [{ url: 'https://rpc-beta.api-selection.synthetic.invalid' }],
    explorers: [{ url: 'https://beta.api-selection.synthetic.invalid' }],
  },
  {
    name: 'Selection Gamma',
    chain: INetworkType.Ethereum,
    chainId: 5700,
    nativeCurrency: { symbol: 'GAMMA' },
    rpc: [{ url: 'https://rpc-gamma.api-selection.synthetic.invalid' }],
    explorers: [{ url: 'https://gamma.api-selection.synthetic.invalid' }],
  },
];
const BLOCKBOOK = 'https://blockbook.api-selection.synthetic.invalid';
const API_A =
  'https://api-alpha.api-selection.synthetic.invalid/api?apikey=synthetic-a';
const API_B =
  'https://api-beta.api-selection.synthetic.invalid/api?apikey=synthetic-b';
const mockLocation = {
  pathname: '/settings/networks/custom-rpc',
  search: '',
  hash: '',
  key: 'network-api-selection',
  state: {} as any,
};
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockEmitter = jest.fn();
const originalChrome = global.chrome;
const originalFetch = globalThis.fetch;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let wallet: any;
let records: Record<string, any>;
let reads: Array<{ method: string; url: string }>;
let unexpectedReads: number;
let heldAlpha: { promise: Promise<void>; resolve: () => void } | null;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  clearCustomRpcDrafts();
  clearRpcCaches();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  mockLocation.state = {
    customRpcDraftId: '00000000-0000-4000-8000-000000000001',
  };
  window.history.replaceState({ key: mockLocation.key }, '', '/app.html');
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  records = {};
  reads = [];
  unexpectedReads = 0;
  heldAlpha = null;
  globalThis.fetch = jest.fn(async (input, options) => {
    const url = String(input);
    if (url === `${BLOCKBOOK}/api/v2`) {
      expect(options?.method).toBeUndefined();
      reads.push({ method: 'blockbook-info', url });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          blockbook: { network: 'Syscoin Testnet', coin: 'Syscoin Testnet' },
          backend: { chain: 'test' },
        }),
      } as Response;
    }
    const chain = chains.find((item) => item.rpc[0].url === url);
    if (chain) {
      expect(options?.method).toBe('POST');
      const body = JSON.parse(String(options?.body));
      const calls = Array.isArray(body) ? body : [body];
      for (const call of calls) {
        expect(['eth_chainId', 'eth_blockNumber']).toContain(call.method);
        expect(call.params).toEqual([]);
        reads.push({ url, method: call.method });
      }
      if (chain === chains[0] && heldAlpha) {
        const held = heldAlpha;
        heldAlpha = null;
        await held.promise;
      }
      const result = calls.map((call: any) => ({
        jsonrpc: '2.0',
        id: call.id,
        result:
          call.method === 'eth_chainId'
            ? `0x${chain.chainId.toString(16)}`
            : '0x10',
      }));
      return {
        ok: true,
        status: 200,
        json: async () => (Array.isArray(body) ? result : result[0]),
      } as Response;
    }
    const api = new URL(url);
    const allowed = [new URL(API_A), new URL(API_B)].find(
      (item) => item.origin === api.origin && item.pathname === api.pathname
    );
    if (allowed) {
      expect(options?.method).toBe('GET');
      expect(api.searchParams.get('apikey')).toBe(
        allowed.searchParams.get('apikey')
      );
      expect(api.searchParams.get('module')).toBe('block');
      expect(api.searchParams.get('action')).toBe('eth_block_number');
      reads.push({ url, method: 'explorer-block-number' });
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: '0x10' }),
      } as Response;
    }
    unexpectedReads += 1;
    throw new Error('Unexpected synthetic public read');
  });
  global.chrome = {
    runtime: { id: 'synthetic-network-api-selection' },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          Object.assign(records, clone(items));
          callback();
        },
        remove: (keys: string[], callback: () => void) => {
          keys.forEach((key) => delete records[key]);
          callback();
        },
      },
    },
  } as any;
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: source,
      isBitcoinBased: false,
    })
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setNetworks({ ethereum: { 1: source }, syscoin: {} }));
  wallet = Object.create(MainController.prototype);
  wallet.walletStateGeneration = 0;
  wallet.walletSessionGeneration = 0;
  wallet.isRemovingNetwork = false;
  wallet.keyrings = new Map();
  wallet.resetAutoLockTimer = jest.fn();
  wallet.evmAssetsController = {
    detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
  };
  wallet.evmTransactionsController = EvmTransactionsController();
  mockEmitter.mockImplementation(async ([family, method], args) => {
    expect(family).toBe('wallet');
    if (method === 'getChainData')
      return args[0] === INetworkType.Ethereum ? chains : [];
    if (
      [
        'getRpc',
        'addCustomRpc',
        'editCustomRpc',
        'testRpcConnection',
        'testExplorerApi',
      ].includes(method)
    )
      return wallet[method](...args);
    throw new Error('Unexpected controller method: ' + method);
  });
  await persistCommittedWalletState(true);
});

afterEach(() => {
  cleanup();
  expect(unexpectedReads).toBe(0);
  clearCustomRpcDrafts();
  clearRpcCaches();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
  globalThis.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
  jest.clearAllTimers();
  jest.useRealTimers();
});

const open = () => {
  render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
};
const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  index: number
) => {
  const field = screen.getByRole('combobox');
  await user.clear(field);
  await user.type(field, chains[index].name);
  await user.click(
    await screen.findByRole('option', { name: new RegExp(chains[index].name) })
  );
  await act(async () => jest.advanceTimersByTimeAsync(2300));
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
};
const apiField = () =>
  screen.getByPlaceholderText('https://api.example.com/api');
const enterApi = (value: string) =>
  fireEvent.change(apiField(), { target: { value } });
const save = async (
  user: ReturnType<typeof userEvent.setup>,
  method = 'addCustomRpc',
  chainId = 31338
) => {
  await act(async () =>
    user.click(screen.getByRole('button', { name: 'buttons.save' }))
  );
  const calls = mockEmitter.mock.calls.filter(
    ([[, called]]) => called === method
  );
  expect(calls).toHaveLength(1);
  await expect(
    mockEmitter.mock.results[mockEmitter.mock.calls.indexOf(calls[0])].value
  ).resolves.toBeDefined();
  expect(mockAlert.success).toHaveBeenCalledWith(
    method === 'addCustomRpc'
      ? 'settings.rpcSuccessfullyAdded'
      : 'settings.rpcSuccessfullyEdited'
  );
  const persisted = await loadState();
  return {
    live: store.getState().vaultGlobal.networks.ethereum[chainId],
    saved: persisted?.vaultGlobal.networks.ethereum[chainId],
  };
};

const discoverUtxoAndReturn = async (
  user: ReturnType<typeof userEvent.setup>
) => {
  await user.click(
    screen.getByRole('switch', { name: 'settings.networkFamilyLabel' })
  );
  expect(
    screen.queryByPlaceholderText('https://api.example.com/api')
  ).toBeNull();
  const url = screen.getByPlaceholderText('settings.blockbookUrlPlaceholder');
  await user.clear(url);
  await user.type(url, BLOCKBOOK);
  await user.tab();
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(
    screen.getByPlaceholderText('settings.chainIdAutoDetectedUtxo')
  ).toHaveValue('5700');
  const index = mockEmitter.mock.calls.findIndex(
    ([[, method], args]) =>
      method === 'getRpc' && args[0].isSyscoinRpc && args[0].url === BLOCKBOOK
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await expect(mockEmitter.mock.results[index].value).resolves.toMatchObject({
    kind: INetworkType.Syscoin,
    chainId: 5700,
    slip44: 1,
  });
  expect(reads).toContainEqual({
    method: 'blockbook-info',
    url: `${BLOCKBOOK}/api/v2`,
  });
  await user.click(
    screen.getByRole('switch', { name: 'settings.networkFamilyLabel' })
  );
};

it('does not inherit Alpha API when the ordinary catalogue selection changes to Beta', async () => {
  const user = open();
  await choose(user, 0);
  enterApi(API_A);
  await choose(user, 1);
  expect(apiField()).toHaveValue('');
});

it('does not durably associate Beta with the inherited Alpha explorer API', async () => {
  const user = open();
  await choose(user, 0);
  enterApi(API_A);
  await choose(user, 1);
  const result = await save(user);
  expect(result.saved?.apiUrl).toBe('');
  expect(result.live).toMatchObject({
    chainId: 31338,
    url: chains[1].rpc[0].url,
    apiUrl: '',
  });
  expect(result.saved).toEqual(result.live);
});

it('keeps a fresh Beta catalogue selection valid with no optional API', async () => {
  const user = open();
  await choose(user, 1);
  const result = await save(user);
  expect(result.live).toMatchObject({ chainId: 31338, apiUrl: '' });
  expect(result.saved).toEqual(result.live);
});

it('preserves an API explicitly supplied after choosing Beta', async () => {
  const user = open();
  await choose(user, 0);
  enterApi(API_A);
  await choose(user, 1);
  enterApi(API_B);
  const result = await save(user);
  expect(result.live).toMatchObject({ chainId: 31338, apiUrl: API_B });
  expect(result.saved).toEqual(result.live);
});

it('preserves the explicit API when reselecting the same chain', async () => {
  const user = open();
  await choose(user, 0);
  enterApi(API_A);
  await choose(user, 0);
  expect(apiField()).toHaveValue(API_A);
});

it('does not carry an old EVM API through manual UTXO discovery into a same-numbered new EVM chain', async () => {
  const user = open();
  await choose(user, 0);
  enterApi(API_A);
  await discoverUtxoAndReturn(user);
  await choose(user, 2);
  const result = await save(user, 'addCustomRpc', 5700);
  expect(result.saved?.apiUrl).toBe('');
  expect(apiField()).toHaveValue('');
  expect(result.live).toMatchObject({
    chainId: 5700,
    apiUrl: '',
    url: chains[2].rpc[0].url,
  });
  expect(result.saved).toEqual(result.live);
});

it('keeps a family round trip with an initially empty API healthy', async () => {
  const user = open();
  await choose(user, 0);
  await discoverUtxoAndReturn(user);
  await choose(user, 2);
  const result = await save(user, 'addCustomRpc', 5700);
  expect(result.live).toMatchObject({ chainId: 5700, apiUrl: '' });
  expect(result.saved).toEqual(result.live);
});

it('preserves an unchanged existing editor API through actual durable save', async () => {
  const network = await wallet.getRpc({
    url: chains[1].rpc[0].url,
    label: chains[1].name,
    symbol: 'BETA',
    explorer: chains[1].explorers[0].url,
    apiUrl: API_B,
  });
  await wallet.addCustomRpc(network);
  mockLocation.state = {
    ...mockLocation.state,
    isEditing: true,
    isDefault: false,
    selected: { kind: INetworkType.Ethereum, chainId: 31338 },
  };
  const user = open();
  expect(apiField()).toHaveValue(API_B);
  const result = await save(user, 'editCustomRpc');
  expect(result.live.apiUrl).toBe(API_B);
  expect(result.saved).toEqual(result.live);
});

it('does not let a held Alpha endpoint response overwrite a later Beta selection', async () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  heldAlpha = { promise, resolve: () => resolve() };
  const user = open();
  const field = screen.getByRole('combobox');
  await user.type(field, chains[0].name);
  await user.click(
    await screen.findByRole('option', { name: new RegExp(chains[0].name) })
  );
  await act(async () => jest.advanceTimersByTimeAsync(300));
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  await choose(user, 1);
  await act(async () => {
    resolve();
    await jest.advanceTimersByTimeAsync(2300);
  });
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    chains[1].rpc[0].url
  );
  expect(screen.getByPlaceholderText('settings.chainIdCustomEvm')).toHaveValue(
    '31338'
  );
  expect(
    mockAlert.success.mock.calls.filter(([message]) =>
      message.includes('Selection Alpha')
    )
  ).toHaveLength(0);
});
