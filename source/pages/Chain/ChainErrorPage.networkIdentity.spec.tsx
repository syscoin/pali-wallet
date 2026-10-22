/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ts from 'typescript';

let mockWallet: any;
const mockEmitter = jest.fn();
jest.mock('scripts/Background', () => ({
  getController: () => ({ wallet: mockWallet, dapp: { get: () => null } }),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { error: jest.fn(), success: jest.fn() },
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { error: jest.fn(), success: jest.fn() },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'networkMenu.evmNetworks': 'EVM networks',
        'networkMenu.utxoNetworks': 'UTXO networks',
      }[key] || key),
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/ChainIcon', () => ({
  ChainIcon: ({ chainId, networkKind }: any) => (
    <span
      data-testid="chain-icon"
      data-chain-id={chainId}
      data-kind={networkKind}
    />
  ),
}));
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
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => (
    <div data-testid="status-tooltip" data-content={content || ''}>
      {children}
    </div>
  ),
}));

import { ConnectionStatusIndicator } from 'components/Header/ConnectionStatusIndicator';
import { NetworkMenu } from 'components/Header/Menus/NetworkMenu';
import MainController from 'scripts/Background/controllers/MainController';
import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import * as actions from 'state/vaultGlobal';
import { INetwork, INetworkType, KeyringAccountType } from 'types/network';
import { PALI_NETWORKS_STATE } from 'utils/constants';

import { ChainErrorPage } from './ChainErrorPage';

const SYSCOIN_UTXO = PALI_NETWORKS_STATE.syscoin[57];
const SYSCOIN_EVM = PALI_NETWORKS_STATE.ethereum[57];
const ETHEREUM = PALI_NETWORKS_STATE.ethereum[1];
const FAILURE = 'Synthetic platform storage read failure';
const originalChrome = global.chrome;
let faultKey: string;
let reads: string[];
let sourceKeyring: any;

const initialize = (source: INetwork, target: INetwork) => {
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  reads = [];
  faultKey = `state-vault-${target.slip44}`;
  const records: Record<string, unknown> = {};
  global.chrome = {
    ...originalChrome,
    runtime: { ...originalChrome.runtime },
    storage: {
      local: {
        get: jest.fn((keys: string[], callback: (result: any) => void) => {
          reads.push(...keys);
          if (keys.includes(faultKey)) {
            (chrome.runtime as any).lastError = { message: FAILURE };
            callback({});
            delete (chrome.runtime as any).lastError;
            return;
          }
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, records[key]])
            )
          );
        }),
        set: jest.fn((items: Record<string, unknown>, callback: () => void) => {
          Object.assign(records, items);
          callback();
        }),
      },
    },
  } as any;
  const initial = store.getState();
  store.dispatch(
    restoreVaultSnapshot({
      ...initial.vault,
      activeNetwork: source,
      isBitcoinBased: source.kind === INetworkType.Syscoin,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      accounts: {
        ...initial.vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            label: 'Synthetic source',
            address:
              source.kind === INetworkType.Syscoin
                ? 'sys1synthetic'
                : `0x${'11'.repeat(20)}`,
            xpub: 'synthetic-public-xpub',
            xprv: '',
            isImported: false,
            isLedgerWallet: false,
            isTrezorWallet: false,
            balances: { syscoin: 0, ethereum: 0 },
          },
        },
      },
    } as any)
  );
  store.dispatch(
    actions.rehydrate({
      ...initial.vaultGlobal,
      activeSlip44: source.slip44,
      networkStatus: 'idle',
      networkTarget: undefined,
      networks: PALI_NETWORKS_STATE,
      loadingStates: { isLoadingBalances: false },
    } as any)
  );
  sourceKeyring = {
    isUnlocked: jest.fn(() => true),
    transferSessionTo: jest.fn(() => {
      throw new Error('Must not reach transfer after failed load');
    }),
  };
  mockWallet = Object.create(MainController.prototype);
  Object.assign(mockWallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    networkRequestGeneration: 0,
    isCreatingWallet: false,
    recoveryJournalPending: false,
    isRemovingNetwork: false,
    isResettingWallet: false,
    assetUpdateRequestId: 0,
    cancellablePromises: {},
    keyrings: new Map([[source.slip44, sourceKeyring]]),
    // Only unrelated background-refresh scheduling is replaced. Target
    // activation, vault-cache loading, Chrome error handling and error state
    // use their real production methods.
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    setFiat: jest.fn(async () => undefined),
  });
  // Retain these exact arrow fields, following the existing network-quality
  // harness; Object.create alone cannot instantiate class field initializers.
  const file = require.resolve('scripts/Background/controllers/MainController');
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
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
  mockEmitter.mockImplementation(async ([namespace, method], args) => {
    if (namespace !== 'wallet' || method !== 'setActiveNetwork')
      throw new Error('Unexpected controller action');
    return mockWallet.setActiveNetwork(...args);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => {
  cleanup();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

it.each([
  { source: SYSCOIN_UTXO, target: SYSCOIN_EVM, group: 'EVM networks' },
  { source: SYSCOIN_EVM, target: SYSCOIN_UTXO, group: 'UTXO networks' },
  { source: SYSCOIN_UTXO, target: ETHEREUM, group: 'EVM networks' },
])(
  'shows $source.label and $target.label after a failed ordinary network switch',
  async ({ source, target, group }) => {
    initialize(source, target);
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route
              path="/home"
              element={
                <>
                  <NetworkMenu />
                  <ConnectionStatusIndicator />
                </>
              }
            />
            <Route
              path="/chain-fail-to-connect"
              element={
                <section data-testid="error-page">
                  <ChainErrorPage />
                </section>
              }
            />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
    await user.click(
      screen.getByRole('button', { name: new RegExp(`^${source.label}`) })
    );
    await user.click(screen.getByRole('menuitem', { name: group }));
    await user.click(
      within(screen.getByRole('group', { name: group })).getByRole('menuitem', {
        name: target.label,
      })
    );
    await waitFor(() =>
      expect(store.getState().vaultGlobal.networkStatus).toBe('error')
    );
    expect(reads).toContain(faultKey);
    expect(store.getState().vault.activeNetwork).toEqual(source);
    expect(store.getState().vaultGlobal.activeSlip44).toBe(source.slip44);
    expect(store.getState().vaultGlobal.networkTarget).toEqual(target);
    expect(store.getState().vaultGlobal.error).toBe(FAILURE);
    expect(sourceKeyring.transferSessionTo).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByTestId('status-tooltip').firstElementChild as HTMLElement
    );
    const page = await screen.findByTestId('error-page');
    const icons = within(page).getAllByTestId('chain-icon');
    expect(
      icons.map((icon) => [icon.dataset.kind, Number(icon.dataset.chainId)])
    ).toEqual([
      [source.kind, source.chainId],
      [target.kind, target.chainId],
    ]);
    expect(within(page).getByText(source.label, { exact: true })).toBeVisible();
    expect(within(page).getByText(target.label, { exact: true })).toBeVisible();
    expect(
      within(page).getByRole('button', { name: 'buttons.retryConnect' })
    ).toBeEnabled();
    expect(
      within(page).getByRole('button', { name: 'chainError.editCurrentRpc' })
    ).toBeEnabled();
  }
);

it.each([SYSCOIN_UTXO, SYSCOIN_EVM])(
  'keeps one current-chain icon for a $label reconnect',
  (network) => {
    initialize(
      network,
      network.kind === INetworkType.Syscoin ? SYSCOIN_EVM : SYSCOIN_UTXO
    );
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ChainErrorPage />
        </MemoryRouter>
      </Provider>
    );
    const icons = screen.getAllByTestId('chain-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('data-kind', network.kind);
    expect(icons[0]).toHaveAttribute('data-chain-id', String(network.chainId));
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  }
);
