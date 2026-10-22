/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { clearRpcCaches } from '@sidhujag/sysweb3-network';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { createServer, Server } from 'http';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import ts from 'typescript';

import { NetworkMenu } from 'components/Header/Menus/NetworkMenu';
import Currency from 'pages/Settings/Currency';
import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';
import MainController from 'scripts/Background/controllers/MainController';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import * as actions from 'state/vaultGlobal';
import { INetworkType } from 'types/network';

let mockWallet: any;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };

jest.mock('scripts/Background', () => ({
  getController: () => ({ wallet: mockWallet, dapp: { get: () => null } }),
  notificationManager: { cleanup: jest.fn(), notifyNetworkChange: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
  usePrice: jest.requireActual('hooks/usePrice').usePrice,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
  subscribeControllerStatus: () => () => undefined,
}));
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
  ArrowDownSvg: () => null,
}));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, description }: any) =>
    show ? <div>{description}</div> : null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, type, onClick }: any) => (
    <button disabled={disabled} type={type} onClick={onClick}>
      {children}
    </button>
  ),
  IconButton: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Icon: ({ name }: any) => <span>{name}</span>,
  Tooltip: ({ children }: any) => children,
  DefaultModal: () => null,
  PageActionFooter: ({ children }: any) => <footer>{children}</footer>,
  ConfirmationModal: () => null,
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const initial = clone(store.getState());
const original = {
  fetch: global.fetch,
  chrome: global.chrome,
  MessageChannel: global.MessageChannel,
  ResizeObserver: global.ResizeObserver,
  matchMedia: Object.getOwnPropertyDescriptor(window, 'matchMedia'),
};
let records: Record<string, any>;
let requests: Array<{ method: string; path: string; rpcMethod?: string }>;
let server: Server;
let url: string;
let rpcChainId = 5700;

const renderPage = (
  page: React.ReactNode,
  entry: any = '/settings/networks/custom-rpc'
) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[entry]}>{page}</MemoryRouter>
    </Provider>
  );

const saveAndActivateSymbol = async (chainId: number, symbol: string) => {
  const user = userEvent.setup();
  rpcChainId = chainId;
  const existing = store.getState().vaultGlobal.networks.ethereum[chainId];
  if (existing) expect(existing.default).toBe(false);
  renderPage(
    <CustomRPC />,
    existing
      ? {
          pathname: '/settings/networks/custom-rpc',
          state: {
            selected: { chainId, kind: INetworkType.Ethereum },
            chain: INetworkType.Ethereum,
            isEditing: true,
            isDefault: existing.default,
          },
        }
      : '/settings/networks/custom-rpc'
  );
  if (!existing) {
    await user.type(screen.getByRole('combobox'), 'Native unit fixture');
    await user.type(
      screen.getByPlaceholderText('settings.chainIdCustomEvm'),
      String(chainId)
    );
  }
  const rpc = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
  await user.clear(rpc);
  await user.type(rpc, url);
  const symbolInput = screen.getByPlaceholderText('settings.symbol');
  expect(symbolInput).toBeEnabled();
  await user.clear(symbolInput);
  await user.type(symbolInput, symbol);
  const explorer = document.querySelector(
    'input#rpc_explorer'
  ) as HTMLInputElement;
  await user.clear(explorer);
  await user.type(explorer, url);
  const api = document.querySelector('input#rpc_apiUrl') as HTMLInputElement;
  await user.clear(api);
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(
      store.getState().vaultGlobal.networks.ethereum[chainId]
    ).toMatchObject({
      currency: symbol.toLowerCase(),
      url,
    })
  );
  expect(
    (await loadState()).vaultGlobal.networks.ethereum[chainId].currency
  ).toBe(symbol.toLowerCase());
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
  expect(requests.some((request) => request.rpcMethod === 'eth_chainId')).toBe(
    true
  );
  cleanup();

  const saved = store.getState().vaultGlobal.networks.ethereum[chainId];
  const from = store.getState().vault.activeNetwork;
  renderPage(<NetworkMenu />);
  await user.click(
    screen.getByRole('button', { name: new RegExp('^' + from.label) })
  );
  await user.click(
    screen.getByRole('menuitem', { name: 'networkMenu.evmNetworks' })
  );
  await user.click(
    within(
      screen.getByRole('group', { name: 'networkMenu.evmNetworks' })
    ).getByRole('menuitem', { name: saved.label })
  );
  await waitFor(() =>
    expect(store.getState().vault.activeNetwork).toEqual(saved)
  );
  await waitFor(() =>
    expect(store.getState().vaultGlobal.networkStatus).toBe('idle')
  );
  expect(records['state-vault-60'].activeNetwork).toEqual(saved);
  expect(saved.currency).toBe(symbol.toLowerCase());
  cleanup();
};

const balanceCard = () =>
  screen.getByText('components.currentBalance').parentElement!;

beforeEach(async () => {
  jest.clearAllMocks();
  clearRpcCaches();
  clearCustomRpcDrafts();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  records = {};
  requests = [];
  rpcChainId = 5700;
  // Start with the ordinary registry; symbol changes must enter through UI.
  store.dispatch(restoreVaultSnapshot(clone(initial.vault)));
  store.dispatch(
    actions.rehydrate({ ...clone(initial.vaultGlobal), activeSlip44: 57 })
  );

  const transport = jest.requireActual('node-fetch');
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const parsed = body ? JSON.parse(body) : undefined;
    requests.push({
      method: request.method!,
      path: request.url!,
      ...(parsed ? { rpcMethod: parsed.method } : {}),
    });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/v2') {
      response.end(
        JSON.stringify({
          blockbook: { coin: 'Litecoin', network: 'LTC' },
          backend: { chain: 'main' },
        })
      );
    } else if (
      request.method === 'POST' &&
      request.url === '/' &&
      parsed?.method === 'eth_chainId'
    ) {
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: '0x' + rpcChainId.toString(16),
        })
      );
    } else {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'Unexpected synthetic request' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No loopback port');
  url = `http://127.0.0.1:${address.port}`;
  global.fetch = async (target: any, options?: any) => {
    if (String(target) !== url && String(target) !== url + '/api/v2')
      throw Error('Disallowed nonfixture request: ' + String(target));
    return transport(target, { ...options, redirect: 'error' });
  };
  global.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as any;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addListener() {
        return undefined;
      },
      removeListener() {
        return undefined;
      },
    }),
  });
  global.chrome = {
    runtime: { id: 'local-currency-native-symbol' },
    storage: {
      local: {
        get: (keys: string[], done: any) =>
          done(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: any, done: any) => {
          Object.assign(records, clone(items));
          done();
        },
        remove: (keys: string[], done: any) => {
          keys.forEach((key) => delete records[key]);
          done();
        },
      },
    },
  } as any;

  mockWallet = Object.create(MainController.prototype);
  Object.assign(mockWallet, {
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    isRemovingNetwork: false,
    isCreatingWallet: false,
    isResettingWallet: false,
    recoveryJournalPending: false,
    assetUpdateRequestId: 0,
    cancellablePromises: {},
    keyrings: new Map(),
    isNetworkSwitchMainStateDirty: false,
    isStartingUp: true,
    resetAutoLockTimer: jest.fn(),
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    setFiat: jest.fn(async () => undefined),
    getLatestUpdateForCurrentAccount: jest.fn(async () => undefined),
    saveWalletState: jest.fn(async () => undefined),
    evmAssetsController: {
      detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
    },
  });
  // Session/keyring operations are synthetic; network SDK parsing, controller
  // activation, vault hydration, and its native commit barrier remain real.
  // No real derivation, signatures, or SDK keyring activation is claimed.
  for (const slip44 of [57, 60]) {
    const keyring: any = {
      unlocked: slip44 === 57,
      isUnlocked: () => keyring.unlocked,
      transferSessionTo: (target: any) => {
        target.unlocked = true;
      },
      lockWallet: async () => {
        keyring.unlocked = false;
      },
      createFirstAccount: async () => ({
        id: 0,
        label: 'Synthetic public fixture',
        address: slip44 === 60 ? `0x${'11'.repeat(20)}` : 'sys1synthetic',
        xpub: 'synthetic-public-xpub-' + slip44,
        xprv: '',
        slip44,
        isImported: false,
        isLedgerWallet: false,
        isTrezorWallet: false,
        balances: { syscoin: 0, ethereum: 0 },
      }),
      setSignerNetwork: jest.fn(async (network: any) => {
        const actual = await mockWallet.getRpc({
          ...network,
          symbol: network.currency,
          isSyscoinRpc: network.kind === INetworkType.Syscoin,
        });
        expect(actual).toMatchObject({
          url: network.url,
          kind: network.kind,
          chainId: network.chainId,
          slip44: network.slip44,
        });
        return { success: true };
      }),
    };
    mockWallet.keyrings.set(slip44, keyring);
  }
  // Object.create does not instantiate arrow fields. Preserve the exact source
  // implementation as in the network identity controller regression harness.
  const filename = require.resolve(
    'scripts/Background/controllers/MainController'
  );
  const ast = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const klass = ast.statements.find(ts.isClassDeclaration)!;
  for (const name of ['setActiveNetworkLogic', 'handleNetworkChangeError']) {
    const declaration = klass.members.find(
      (member) =>
        ts.isPropertyDeclaration(member) && member.name?.getText(ast) === name
    ) as ts.PropertyDeclaration;
    const js = ts.transpileModule(
      'const actual = ' + declaration.initializer!.getText(ast) + ';',
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
    ).outputText;
    mockWallet[name] = new Function(
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
      mockWallet,
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
  mockEmitter.mockImplementation(async ([area, method], args) => {
    expect(area).toBe('wallet');
    if (method === 'getChainData') return [];
    if (
      ['getRpc', 'addCustomRpc', 'editCustomRpc', 'setActiveNetwork'].includes(
        method
      )
    )
      return mockWallet[method](...args);
    throw Error('Unexpected fixture dispatch: ' + method);
  });
});

afterEach(async () => {
  cleanup();
  clearRpcCaches();
  clearCustomRpcDrafts();
  vaultCache.clearCache();
  global.fetch = original.fetch;
  global.chrome = original.chrome;
  global.MessageChannel = original.MessageChannel;
  global.ResizeObserver = original.ResizeObserver;
  if (original.matchMedia)
    Object.defineProperty(window, 'matchMedia', original.matchMedia);
  else Reflect.deleteProperty(window, 'matchMedia');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

it('shows a user-edited native symbol after the chain 5700 registration is saved and activated', async () => {
  await saveAndActivateSymbol(5700, 'XPAY');
  renderPage(<Currency />, '/settings/currency');
  expect(
    within(balanceCard()).getByText('XPAY', { exact: true })
  ).toBeVisible();
  expect(within(balanceCard()).queryByText('TSYS', { exact: true })).toBeNull();
});

it('keeps TSYS when the ordinary chain 5700 symbol is unchanged', async () => {
  expect(
    store.getState().vaultGlobal.networks.ethereum[5700].currency.toUpperCase()
  ).toBe('TSYS');
  await saveAndActivateSymbol(5700, 'TSYS');
  renderPage(<Currency />, '/settings/currency');
  expect(
    within(balanceCard()).getByText('TSYS', { exact: true })
  ).toBeVisible();
});

it('keeps the custom symbol on a newly registered non-5700 EVM network', async () => {
  expect(store.getState().vaultGlobal.networks.ethereum[31337]).toBeUndefined();
  await saveAndActivateSymbol(31337, 'LOCAL');
  renderPage(<Currency />, '/settings/currency');
  expect(
    within(balanceCard()).getByText('LOCAL', { exact: true })
  ).toBeVisible();
  expect(within(balanceCard()).queryByText('TSYS', { exact: true })).toBeNull();
});

it('does not change the saved fiat units when the native symbol is customized', async () => {
  await saveAndActivateSymbol(5700, 'XPAY');
  renderPage(<Currency />, '/settings/currency');
  expect(balanceCard()).toHaveTextContent('USD');
  expect(balanceCard()).not.toHaveTextContent('NaN');
});
