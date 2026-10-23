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
  waitFor,
  within,
} from '@testing-library/react';
import { readFileSync } from 'fs';
import path from 'path';
import React from 'react';
import { Provider } from 'react-redux';
import * as ts from 'typescript';

import { ConnectionStatusIndicator } from 'components/Header/ConnectionStatusIndicator';
import { NetworkMenu } from 'components/Header/Menus/NetworkMenu';
import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';
import BalancesManager from 'scripts/Background/controllers/balances';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import { walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import * as actions from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

const { CustomJsonRpcProvider } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/providers'
);
const mockEmitter = jest.fn(),
  mockNavigate = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const mockLocation = {
  pathname: '/settings/networks/custom-rpc',
  search: '',
  hash: '',
  key: 'normal-editor',
  state: {
    isEditing: true,
    isDefault: false,
    chain: INetworkType.Ethereum,
    selected: { kind: INetworkType.Ethereum, chainId: 31337 },
    customRpcDraftId: '00000000-0000-4000-8000-000000000123',
  },
};
jest.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({ wallet, dapp: { handleStateChange: jest.fn() } }),
  notificationManager: { cleanup: jest.fn(), notifyNetworkChange: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  BtcIconSvg: () => null,
  EthIconSvg: () => null,
  WhiteSuccessIconSvg: () => null,
  NetworkIconSvg: () => null,
  EditIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, description }: any) =>
    show ? <div role="alert">{description}</div> : null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => (
    <div data-testid="quality-tooltip" data-content={content || ''}>
      {children}
    </div>
  ),
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, type, onClick }: any) => (
    <button disabled={disabled} type={type} onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => children,
  Icon: () => null,
}));

const OLD = {
  chainId: 31337,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Normal custom network',
  currency: 'eth',
  url: 'https://old-quality.synthetic.invalid',
  explorer: 'https://explorer.synthetic.invalid/',
  apiUrl: '',
  default: false,
};
const NEW_URL = 'https://new-quality.synthetic.invalid';
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const originalChrome = global.chrome,
  originalFetch = global.fetch;
const originalMessageChannel = globalThis.MessageChannel;
let wallet: any, records: Record<string, any>;
let currentProvider: any;
let providers: any[] = [];
let httpReads: Array<{ method: string; params: unknown; url: string }> = [];
let releaseHydration: ((balance: string) => void) | undefined;
let hydrationSpy: jest.SpyInstance;
let pendingSwitch: Promise<unknown> | undefined;
let nextChain = OLD.chainId;
const tooltip = () => screen.getByTestId('quality-tooltip');
const indicator = () => tooltip().querySelector('button')!;
const advance = async (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

beforeEach(async () => {
  jest.useFakeTimers({ now: 1000000 });
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  clearRpcCaches();
  clearCustomRpcDrafts();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  records = {};
  pendingSwitch = undefined;
  releaseHydration = undefined;
  nextChain = OLD.chainId;
  providers = [];
  httpReads = [];
  const providerFor = (network: typeof OLD) => {
    const provider = new CustomJsonRpcProvider(
      new AbortController().signal,
      network.url,
      network.chainId
    );
    providers.push(provider);
    return provider;
  };
  currentProvider = providerFor(OLD);
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
  window.history.replaceState({ key: mockLocation.key }, '', '/app.html');
  global.chrome = {
    runtime: { id: 'synthetic-quality' },
    storage: {
      local: {
        get: (keys: string[], callback: any) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: any, callback: any) => {
          Object.assign(records, clone(items));
          callback();
        },
        remove: (keys: string[], callback: any) => {
          keys.forEach((key) => delete records[key]);
          callback();
        },
      },
    },
  } as any;
  global.fetch = jest.fn(async (url: any, options: any) => {
    if (![OLD.url, NEW_URL].includes(url) || options?.method !== 'POST')
      throw Error('Denied non-fixture HTTP');
    const body = JSON.parse(options.body);
    const requests = Array.isArray(body) ? body : [body];
    const responses = await Promise.all(
      requests.map(async (request: any) => {
        httpReads.push({ url, method: request.method, params: request.params });
        let result: string;
        if (
          request.method === 'eth_chainId' &&
          JSON.stringify(request.params) === '[]'
        ) {
          result =
            '0x' + (url === OLD.url ? OLD.chainId : nextChain).toString(16);
        } else if (
          request.method === 'eth_getBalance' &&
          request.params[0].toLowerCase() === '0x' + '11'.repeat(20) &&
          request.params[1] === 'latest'
        ) {
          await new Promise<void>((resolve) => {
            releaseHydration = () => resolve();
          });
          result = '0x1bc16d674ec80000';
        } else throw Error('Denied non-fixture RPC ' + request.method);
        return { jsonrpc: '2.0', id: request.id, result };
      })
    );
    return {
      ok: true,
      status: 200,
      json: async () => (Array.isArray(body) ? responses : responses[0]),
    } as Response;
  }) as any;
  const state = store.getState();
  store.dispatch(
    restoreVaultSnapshot({
      ...state.vault,
      activeNetwork: OLD,
      isBitcoinBased: false,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      accounts: {
        ...state.vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            address: `0x${'11'.repeat(20)}`,
            xpub: 'public-synthetic',
            label: 'Synthetic',
            balances: { ethereum: '2', syscoin: -1 },
          },
        },
      },
    } as any)
  );
  store.dispatch(actions.setActiveSlip44(60));
  store.dispatch(
    actions.setNetworks({ ethereum: { [OLD.chainId]: OLD }, syscoin: {} })
  );
  store.dispatch(actions.switchNetworkSuccess());
  store.dispatch(actions.resetNetworkQualityForNewNetwork());

  wallet = Object.assign(Object.create(MainController.prototype), {
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    assetUpdateRequestId: 0,
    isRemovingNetwork: false,
    isResettingWallet: false,
    isStartingUp: true,
    activeRapidPolls: new Map(),
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    cancellablePromises: new CancellablePromises(),
    receiptBalanceRefresh: { cancel: jest.fn() },
    assertWalletReadyForSigning: jest.fn(),
    resetAutoLockTimer: jest.fn(),
    getActiveKeyring: () => ({
      isUnlocked: () => true,
      ethereumTransaction: { web3Provider: currentProvider },
    }),
    balancesManager: BalancesManager(),
    setFiat: jest.fn().mockResolvedValue(undefined),
    setSignerNetwork: jest.fn(async (network: typeof OLD) => {
      currentProvider = providerFor(network);
      return { success: true };
    }),
    updateAssetsFromCurrentAccount: jest.fn().mockResolvedValue(undefined),
    updateUserTransactionsState: jest.fn().mockResolvedValue(undefined),
    saveWalletState: jest.fn().mockResolvedValue(undefined),
  });
  const file = path.join(__dirname, 'MainController.ts');
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const klass = ast.statements.find(ts.isClassDeclaration)!;
  for (const name of ['setActiveNetworkLogic', 'handleNetworkChangeError']) {
    const declaration = klass.members.find(
      (m) => ts.isPropertyDeclaration(m) && m.name?.getText(ast) === name
    ) as ts.PropertyDeclaration;
    const js = ts.transpileModule(
      'const actual = ' + declaration.initializer!.getText(ast) + ';',
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
    ).outputText;
    wallet[name] = new Function(
      'store',
      'startSwitchNetwork',
      'resetNetworkQualityForNewNetwork',
      'clearNetworkQualityIfStale',
      'INetworkType',
      'NETWORK_CHANGE_CANCELLED_ERROR',
      'setStoreError',
      'switchNetworkError',
      js + '\nreturn actual;'
    ).call(
      wallet,
      store,
      actions.startSwitchNetwork,
      actions.resetNetworkQualityForNewNetwork,
      actions.clearNetworkQualityIfStale,
      INetworkType,
      'Network change cancelled',
      actions.setError,
      actions.switchNetworkError
    );
  }
  hydrationSpy = jest.spyOn(wallet, 'getLatestUpdateForCurrentAccount');
  mockEmitter.mockImplementation(
    async ([namespace, method]: string[], args: any[] = []) => {
      if (namespace !== 'wallet') throw Error('Denied unexpected namespace');
      if (method === 'getChainData') return [];
      if (method === 'setActiveNetwork') {
        pendingSwitch = wallet.setActiveNetwork(...args);
        void pendingSwitch!.catch(() => undefined);
        return pendingSwitch;
      }
      if (method === 'getRpc' || method === 'editCustomRpc')
        return wallet[method](...args);
      throw Error(`Denied unexpected method ${method}`);
    }
  );
  await persistCommittedWalletState(true);
});
afterEach(async () => {
  cleanup();
  if (releaseHydration) {
    await act(async () => {
      releaseHydration?.('2');
      await Promise.all(
        hydrationSpy.mock.results.map((result) => result.value)
      );
    });
  }
  if (pendingSwitch) await pendingSwitch;
  for (let index = 0; index < 5; index++) await Promise.resolve();
  providers.forEach((provider) => provider.destroy());
  global.chrome = originalChrome;
  global.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  vaultCache.clearCache();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const oldSlowRead = async () => {
  const current = store.getState();
  const work = wallet.updateUserNativeBalance({
    isBitcoinBased: false,
    activeNetwork: current.vault.activeNetwork,
    activeAccount: current.vault.activeAccount,
  });
  await advance(6000);
  expect(httpReads).toContainEqual({
    url: OLD.url,
    method: 'eth_getBalance',
    params: ['0x' + '11'.repeat(20), 'latest'],
  });
  await act(async () => {
    releaseHydration?.('2');
    await work;
  });
  expect(store.getState().vaultGlobal.networkQuality).toMatchObject({
    hasSlowOperations: true,
    lastBalanceLatency: 6000,
  });
};
const armHydration = () => {
  releaseHydration = undefined;
};
const waitForHydration = async () => {
  await act(async () => {
    await pendingSwitch;
  });
  await waitFor(() => expect(hydrationSpy).toHaveBeenCalledWith(false, true));
  await waitFor(() => expect(releaseHydration).toBeDefined());
  expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
  expect(store.getState().vaultGlobal.networkTarget).toBeUndefined();
  expect(store.getState().vaultGlobal.isPostNetworkSwitchLoading).toBe(true);
  expect(store.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    true
  );
};
const chooseSaved = async (label = OLD.label) => {
  render(
    <Provider store={store}>
      <NetworkMenu />
      <ConnectionStatusIndicator />
    </Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: new RegExp(OLD.label) }));
  fireEvent.click(
    screen.getByRole('menuitem', { name: 'networkMenu.evmNetworks' })
  );
  fireEvent.click(
    within(
      screen.getByRole('group', { name: 'networkMenu.evmNetworks' })
    ).getByRole('menuitem', { name: label })
  );
  await act(async () => {
    await Promise.resolve();
  });
};

it('normal CustomRPC save and menu activation do not attribute old endpoint latency to the new endpoint', async () => {
  await oldSlowRead();
  const editor = render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  const url = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
  expect(url).toHaveValue(OLD.url);
  fireEvent.change(url, { target: { value: NEW_URL } });
  fireEvent.submit(editor.container.querySelector('form')!);
  await waitFor(() =>
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.rpcSuccessfullyEdited'
    )
  );
  expect(
    httpReads.filter(
      (read) => read.url === NEW_URL && read.method === 'eth_chainId'
    )
  ).toHaveLength(1);
  expect(store.getState().vaultGlobal.networks.ethereum[OLD.chainId].url).toBe(
    NEW_URL
  );
  expect(records.state.vaultGlobal.networks.ethereum[OLD.chainId].url).toBe(
    NEW_URL
  );
  expect(store.getState().vault.activeNetwork.url).toBe(OLD.url);
  editor.unmount();
  armHydration();
  await chooseSaved();
  await waitForHydration();
  expect(wallet.setSignerNetwork).toHaveBeenCalledWith(
    expect.objectContaining({ chainId: OLD.chainId, url: NEW_URL }),
    expect.any(Function)
  );
  expect(store.getState().vault.activeNetwork.url).toBe(NEW_URL);
  expect(httpReads).toContainEqual({
    url: NEW_URL,
    method: 'eth_getBalance',
    params: ['0x' + '11'.repeat(20), 'latest'],
  });
  expect({
    quality: store.getState().vaultGlobal.networkQuality,
    className: indicator().className,
    message: tooltip().getAttribute('data-content'),
  }).toEqual({
    quality: undefined,
    className: expect.stringContaining('bg-brand-blue500'),
    message: 'networkConnection.updatingBalances',
  });
});

it('a real different-chain activation clears old quality', async () => {
  await oldSlowRead();
  const other = { ...OLD, chainId: 31338, label: 'Other chain', url: NEW_URL };
  nextChain = other.chainId;
  store.dispatch(
    actions.setNetworks({
      ethereum: { [OLD.chainId]: OLD, [other.chainId]: other },
      syscoin: {},
    })
  );
  armHydration();
  await chooseSaved(other.label);
  await waitForHydration();
  expect(store.getState().vaultGlobal.networkQuality).toBeUndefined();
  expect(indicator()).toHaveClass('bg-brand-blue500');
});

it('an explicit reconnect to the exact same endpoint preserves recent known latency', async () => {
  await oldSlowRead();
  const known = store.getState().vaultGlobal.networkQuality;
  armHydration();
  act(() => {
    pendingSwitch = wallet.setActiveNetwork(OLD);
    void pendingSwitch!.catch(() => undefined);
  });
  await waitForHydration();
  render(
    <Provider store={store}>
      <ConnectionStatusIndicator />
    </Provider>
  );
  expect(store.getState().vaultGlobal.networkQuality).toEqual(known);
  expect(indicator()).toHaveClass('bg-orange-500');
  expect(tooltip()).toHaveAttribute(
    'data-content',
    'networkConnection.operationSlow'
  );
});

it('stale latency is cleared even for the same endpoint', async () => {
  await oldSlowRead();
  await advance(300001);
  act(() => {
    pendingSwitch = wallet.setActiveNetwork(OLD);
    void pendingSwitch!.catch(() => undefined);
  });
  expect(store.getState().vaultGlobal.networkQuality).toBeUndefined();
});

it.each([
  ['label', 'Renamed network'],
  ['currency', 'renamed'],
  ['explorer', 'https://new-explorer.synthetic.invalid/'],
  ['apiUrl', 'https://new-api.synthetic.invalid/'],
  ['coingeckoId', 'other-price-metadata'],
] as const)(
  'keeps recent endpoint quality for a saved %s-only metadata edit',
  async (field, value) => {
    await oldSlowRead();
    const known = store.getState().vaultGlobal.networkQuality;
    const target = { ...OLD, [field]: value };
    store.dispatch(
      actions.setNetworks({ ethereum: { [OLD.chainId]: target }, syscoin: {} })
    );
    armHydration();
    await chooseSaved(target.label);
    await waitForHydration();
    expect(store.getState().vaultGlobal.networkQuality).toEqual(known);
    expect(indicator()).toHaveClass('bg-orange-500');
  }
);

it.each([
  ['family', { kind: INetworkType.Syscoin, slip44: 57 }],
  ['SLIP44 vault', { slip44: 57 }],
])(
  'retires endpoint quality at the admitted %s transition boundary',
  async (_name, change) => {
    await oldSlowRead();
    // Isolate the real transition entry point: this control checks its identity
    // policy only, without pretending that the EVM form creates a UTXO network.
    await new Promise((resolve, reject) =>
      wallet.setActiveNetworkLogic({ ...OLD, ...change }, resolve, reject)
    );
    expect(store.getState().vaultGlobal.networkQuality).toBeUndefined();
  }
);
