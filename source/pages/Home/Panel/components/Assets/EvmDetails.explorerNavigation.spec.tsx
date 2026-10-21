/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { clearRpcCaches } from '@sidhujag/sysweb3-network';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import * as ts from 'typescript';

import { NetworkMenu } from 'components/Header/Menus/NetworkMenu';
import { AssetsPanel } from 'pages/Home/Panel/AssetsPanel';
import { DetailsView } from 'pages/Home/Panel/components/Details';
import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import {
  loadSlip44State,
  loadState,
  walletPersistenceGate,
} from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import * as globalActions from 'state/vaultGlobal';
import { INetwork, INetworkType, KeyringAccountType } from 'types/network';

const ADDRESS = '0x' + '11'.repeat(20);
const TYPE = KeyringAccountType.HDAccount;
const CONTRACT = '0x' + '22'.repeat(20);
const TOKEN = {
  id: CONTRACT + '-5700',
  contractAddress: CONTRACT,
  chainId: 5700,
  tokenSymbol: 'PUBLIC',
  name: 'Public token',
  balance: 2,
  decimals: 18,
  tokenStandard: 'ERC-20',
  isNft: false,
  // eslint-disable-next-line camelcase
  market_data: {
    // eslint-disable-next-line camelcase
    current_price: { usd: 1 },
  },
};
const SOURCE: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Source EVM',
  currency: 'eth',
  url: 'https://source.synthetic.invalid',
};
const RPC = 'https://rpc.synthetic.invalid';
const LABEL = 'Saved synthetic EVM';
const originalChrome = global.chrome;
const originalFetch = globalThis.fetch;
const originalMessageChannel = globalThis.MessageChannel;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let records: Record<string, any>;
let wallet: any;
let networkSelection: Promise<unknown> | undefined;

jest.mock('scripts/Background', () => ({
  getController: () => ({
    dapp: { handleStateChange: jest.fn(), disconnect: jest.fn() },
  }),
  notificationManager: { cleanup: jest.fn(), notifyNetworkChange: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: useNavigate(), alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: true }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
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
  ExternalLinkSvg: () => null,
  BsCheck2: () => null,
  CgSearch: () => null,
  CgImport: () => null,
  FaRegStickyNote: () => null,
  HiTrash: () => null,
  MdClose: () => null,
  RiArrowLeftSLine: () => null,
  RiCoinLine: () => null,
  RiOrderPlayLine: () => null,
  RiShareForward2Line: () => null,
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
}));
jest.mock('components/Spinner/Spinner', () => () => null);
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, description }: any) =>
    show ? <div role="alert">{description}</div> : null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Tooltip: ({ children }: any) => children,
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  TokenIcon: () => null,
}));

const mountActualRoutes = () =>
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/settings/networks/custom-rpc',
            state: { chain: INetworkType.Ethereum },
          },
        ]}
      >
        <Routes>
          <Route path="/settings/networks/custom-rpc" element={<CustomRPC />} />
          <Route
            path="/home"
            element={
              <>
                <NetworkMenu />
                <AssetsPanel />
              </>
            }
          />
          <Route path="/home/details" element={<DetailsView />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  clearRpcCaches();
  clearCustomRpcDrafts();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  window.history.replaceState({}, '', '/app.html');
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
  global.chrome = {
    runtime: { id: 'synthetic-activity-save-path' },
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
  globalThis.fetch = jest.fn(async (url, options) => {
    expect(String(url)).toBe(RPC);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1644' }),
    } as Response;
  });
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: SOURCE,
      isBitcoinBased: false,
      activeAccount: { type: TYPE, id: 0 },
      accounts: {
        ...store.getState().vault.accounts,
        [TYPE]: {
          0: {
            id: 0,
            address: ADDRESS,
            label: 'Public account',
            balances: { ethereum: '2', syscoin: -1 },
          },
        },
      },
      accountAssets: { [TYPE]: { 0: { ethereum: [TOKEN], syscoin: [] } } },
      accountTransactions: {
        [TYPE]: {
          0: {
            ethereum: {
              5700: [
                {
                  hash: '0x' + 'aa'.repeat(32),
                  from: ADDRESS,
                  to: '0x' + '22'.repeat(20),
                  value: '1',
                  blockNumber: 1,
                },
              ],
            },
            syscoin: {},
          },
        },
      },
    } as any)
  );
  store.dispatch(globalActions.setActiveSlip44(60));
  store.dispatch(
    globalActions.setNetworks({ ethereum: { 1: SOURCE }, syscoin: {} })
  );
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    assetUpdateRequestId: 0,
    isRemovingNetwork: false,
    keyrings: new Map(),
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    activeRapidPolls: new Map(),
    receiptBalanceRefresh: { cancel: jest.fn() },
    cancellablePromises: new CancellablePromises(),
    resetAutoLockTimer: jest.fn(),
    evmAssetsController: {
      detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
    },
    // These are unsigned provider/public-data boundaries. All admission,
    // compatibility, registry persistence and active-network commits remain real.
    setSignerNetwork: jest.fn().mockResolvedValue({ success: true }),
    setFiat: jest.fn().mockResolvedValue(undefined),
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
    saveWalletState: jest.fn().mockResolvedValue(undefined),
  });
  const controllerSource = readFileSync(
    process.cwd() + '/source/scripts/Background/controllers/MainController.ts',
    'utf8'
  );
  const parsed = ts.createSourceFile(
    'MainController.ts',
    controllerSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const cls = parsed.statements.find(ts.isClassDeclaration)!;
  for (const name of ['setActiveNetworkLogic', 'handleNetworkChangeError']) {
    const member = cls.members.find(
      (m) => ts.isPropertyDeclaration(m) && m.name?.getText(parsed) === name
    ) as ts.PropertyDeclaration;
    expect(member?.initializer && ts.isArrowFunction(member.initializer)).toBe(
      true
    );
    const output = ts.transpileModule(
      'const actual = ' + member.initializer!.getText(parsed) + ';',
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
      output + '\nreturn actual;'
    ).call(
      wallet,
      store,
      globalActions.startSwitchNetwork,
      globalActions.resetNetworkQualityForNewNetwork,
      globalActions.clearNetworkQualityIfStale,
      INetworkType,
      'Network change cancelled',
      globalActions.setError,
      globalActions.switchNetworkError
    );
  }
  networkSelection = undefined;
  mockEmitter.mockImplementation(([group, method], args) => {
    expect(group).toBe('wallet');
    if (method === 'getChainData') return Promise.resolve([]);
    if (method === 'getRpc') return wallet.getRpc(args[0]);
    if (method === 'addCustomRpc') return wallet.addCustomRpc(args[0]);
    if (method === 'setActiveNetwork') {
      networkSelection = wallet.setActiveNetwork(args[0]);
      return networkSelection;
    }
    throw new Error('Unexpected controller method: ' + method);
  });
  await persistCommittedWalletState(true);
});
afterEach(() => {
  cleanup();
  global.chrome = originalChrome;
  globalThis.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  vaultCache.clearCache();
  jest.restoreAllMocks();
});

it.each([
  [
    'root',
    'https://explorer.synthetic.invalid/',
    'https://explorer.synthetic.invalid/token/' + CONTRACT,
  ],
  [
    'path',
    'https://explorer.synthetic.invalid/public/',
    'https://explorer.synthetic.invalid/public/token/' + CONTRACT,
  ],
  [
    'query',
    'https://explorer.synthetic.invalid/public/?view=compact',
    'https://explorer.synthetic.invalid/public/token/' +
      CONTRACT +
      '?view=compact',
  ],
])(
  'normal CustomRPC Save and asset-detail navigation preserve the token route for %s',
  async (_label, explorer, expected) => {
    const view = mountActualRoutes();
    fireEvent.change(screen.getByRole('combobox', { name: 'settings.label' }), {
      target: { value: LABEL },
    });
    fireEvent.change(
      screen.getByPlaceholderText('settings.rpcUrlPlaceholder'),
      { target: { value: RPC } }
    );
    fireEvent.change(screen.getByPlaceholderText('settings.chainIdCustomEvm'), {
      target: { value: '5700' },
    });
    fireEvent.change(screen.getByPlaceholderText('settings.symbol'), {
      target: { value: 'SYS' },
    });
    fireEvent.change(screen.getByPlaceholderText('settings.explorer'), {
      target: { value: explorer },
    });
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() =>
      expect(mockAlert.success).toHaveBeenCalledWith(
        'settings.rpcSuccessfullyAdded'
      )
    );
    expect(mockAlert.error).not.toHaveBeenCalled();
    const registered = store.getState().vaultGlobal.networks.ethereum[5700];
    expect(registered).toEqual(
      expect.objectContaining({
        chainId: 5700,
        kind: INetworkType.Ethereum,
        label: LABEL,
        url: RPC,
        explorer,
        default: false,
      })
    );
    expect((await loadState()).vaultGlobal.networks.ethereum[5700]).toEqual(
      registered
    );
    expect(store.getState().vault.activeNetwork).toEqual(SOURCE);
    expect(
      mockEmitter.mock.calls.filter(([[, method]]) => method === 'addCustomRpc')
    ).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Source EVM/ }));
    await user.click(
      screen.getByRole('menuitem', { name: 'networkMenu.evmNetworks' })
    );
    await user.click(
      within(
        screen.getByRole('group', { name: 'networkMenu.evmNetworks' })
      ).getByRole('menuitem', { name: LABEL })
    );
    await waitFor(() => expect(networkSelection).toBeDefined());
    await networkSelection;
    await waitFor(() =>
      expect(store.getState().vault.activeNetwork).toEqual(registered)
    );
    expect((await loadSlip44State(60))!.activeNetwork).toEqual(registered);
    expect(store.getState().vault.activeAccount).toEqual({ type: TYPE, id: 0 });
    expect(wallet.setSignerNetwork).toHaveBeenCalledWith(
      registered,
      expect.any(Function)
    );
    await user.click(
      screen.getByRole('button', { name: 'View details for PUBLIC token' })
    );
    const link = await screen.findByRole('link', {
      name: 'home.viewOnExplorer',
    });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', expected);
  }
);
