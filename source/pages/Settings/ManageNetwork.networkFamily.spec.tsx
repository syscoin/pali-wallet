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
import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';
import ManageNetwork from 'pages/Settings/ManageNetwork';
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
  // These tests inspect action eligibility, not confirmation or deletion.
  ConfirmationModal: () => null,
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const initial = clone(store.getState());
const original = {
  fetch: global.fetch,
  chrome: global.chrome,
  MessageChannel: global.MessageChannel,
  ResizeObserver: global.ResizeObserver,
};
let records: Record<string, any>;
let requests: Array<{ method: string; path: string; rpcMethod?: string }>;
let server: Server;
let url: string;

const renderPage = (page: React.ReactNode) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings/networks/custom-rpc']}>
        {page}
      </MemoryRouter>
    </Provider>
  );

const registerBothFamilies = async () => {
  const user = userEvent.setup();
  expect(store.getState().vaultGlobal.networks.syscoin[2]).toBeUndefined();
  expect(store.getState().vaultGlobal.networks.ethereum[2]).toBeUndefined();
  renderPage(<CustomRPC />);
  await user.click(screen.getByRole('switch', { name: 'Syscoin Network' }));
  await user.type(screen.getByRole('combobox'), 'Multiplex Litecoin');
  await user.type(
    screen.getByPlaceholderText('settings.blockbookUrlPlaceholder'),
    url
  );
  await user.tab();
  await waitFor(() =>
    expect(
      screen.getByPlaceholderText('settings.chainIdAutoDetectedUtxo')
    ).toHaveValue('2')
  );
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(store.getState().vaultGlobal.networks.syscoin[2]).toMatchObject({
      url,
      chainId: 2,
      slip44: 2,
      kind: INetworkType.Syscoin,
      default: false,
    })
  );
  cleanup();

  renderPage(<CustomRPC />);
  expect(
    screen.getByRole('switch', { name: 'Syscoin Network' })
  ).toHaveAttribute('aria-checked', 'false');
  await user.type(screen.getByRole('combobox'), 'Multiplex EVM');
  await user.type(
    screen.getByPlaceholderText('settings.rpcUrlPlaceholder'),
    url
  );
  await user.tab();
  await waitFor(() =>
    expect(
      screen.getByPlaceholderText('settings.chainIdCustomEvm')
    ).toHaveValue('2')
  );
  await user.type(screen.getByPlaceholderText('settings.symbol'), 'EXP');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(store.getState().vaultGlobal.networks.ethereum[2]).toMatchObject({
      url,
      chainId: 2,
      slip44: 60,
      kind: INetworkType.Ethereum,
      default: false,
    })
  );
  const saved = await loadState();
  for (const family of ['syscoin', 'ethereum'] as const) {
    expect(saved.vaultGlobal.networks[family][2]).toEqual(
      store.getState().vaultGlobal.networks[family][2]
    );
  }
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(mockAlert.success).toHaveBeenCalledTimes(2);
  expect(requests).toEqual([
    { method: 'GET', path: '/api/v2' },
    { method: 'POST', path: '/', rpcMethod: 'eth_chainId' },
  ]);
  cleanup();
};

beforeEach(async () => {
  jest.clearAllMocks();
  clearRpcCaches();
  clearCustomRpcDrafts();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  records = {};
  requests = [];
  // Ordinary initial state only; both colliding records must enter through UI.
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
        JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: '0x2' })
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
    runtime: { id: 'local-network-family-identity' },
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
  for (const slip44 of [57, 2, 60]) {
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
        address: slip44 === 60 ? `0x${'11'.repeat(20)}` : 'ltc1synthetic',
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
    if (['getRpc', 'addCustomRpc', 'setActiveNetwork'].includes(method))
      return mockWallet[method](...args);
    throw Error('Unexpected fixture dispatch: ' + method);
  });
  await registerBothFamilies();
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
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

it.each(['syscoin', 'ethereum'] as const)(
  'distinguishes the inactive opposite family after an ordinary %s network switch',
  async (family) => {
    const user = userEvent.setup();
    const target = store.getState().vaultGlobal.networks[family][2];
    const source = store.getState().vault.activeNetwork;
    renderPage(<NetworkMenu />);
    await user.click(
      screen.getByRole('button', { name: new RegExp('^' + source.label) })
    );
    const group =
      family === 'syscoin'
        ? 'networkMenu.utxoNetworks'
        : 'networkMenu.evmNetworks';
    await user.click(screen.getByRole('menuitem', { name: group }));
    await user.click(
      within(screen.getByRole('group', { name: group })).getByRole('menuitem', {
        name: target.label,
      })
    );
    await waitFor(() =>
      expect(store.getState().vaultGlobal.networkStatus).toBe('idle')
    );
    await waitFor(() =>
      expect(store.getState().vault.activeNetwork).toEqual(target)
    );
    expect(store.getState().vaultGlobal.activeSlip44).toBe(target.slip44);
    expect((await loadState()).vaultGlobal.activeSlip44).toBe(target.slip44);
    expect(records['state-vault-' + target.slip44].activeNetwork).toEqual(
      target
    );
    expect(
      mockWallet.keyrings.get(target.slip44).setSignerNetwork
    ).toHaveBeenCalledWith(target);
    cleanup();

    renderPage(<ManageNetwork />);
    const activeRow = screen.getByText(target.label).closest('li')!;
    expect(activeRow).toHaveTextContent('components.activeStatus');
    expect(
      within(activeRow).getByRole('button', { name: 'trash' })
    ).toBeDisabled();
    const bitcoin = screen.getByText('Bitcoin').closest('li')!;
    expect(bitcoin).not.toHaveTextContent('components.activeStatus');
    expect(
      within(bitcoin).getByRole('button', { name: 'trash' })
    ).toBeEnabled();

    const other =
      store.getState().vaultGlobal.networks[
        family === 'syscoin' ? 'ethereum' : 'syscoin'
      ][2];
    const inactiveRow = screen.getByText(other.label).closest('li')!;
    expect(inactiveRow).not.toHaveTextContent('components.activeStatus');
    expect(
      within(inactiveRow).getByRole('button', { name: 'trash' })
    ).toBeEnabled();
  }
);
