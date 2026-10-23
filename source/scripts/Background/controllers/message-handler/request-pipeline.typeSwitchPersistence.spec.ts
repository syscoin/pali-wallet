/**
 * @jest-environment ./tests/connected-sites-dom-env.cjs
 */
import '@testing-library/jest-dom';

jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { info: jest.fn(), error: jest.fn(), success: jest.fn() },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: (methods: string[], args: any[] = []) => {
      if (methods[0] === 'wallet' && methods[1] === 'setActiveNetwork')
        return mockController.wallet.setActiveNetwork(...args);
      if (methods[0] === 'dapp' && methods[1] === 'disconnect')
        return mockController.dapp.disconnect(...args);
      throw new Error(`Unexpected UI controller call ${methods.join('.')}`);
    },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { number?: number }) =>
      key === 'settings.accountNumber'
        ? jest
            .requireActual('../../../../assets/locales/en.json')
            .settings.accountNumber.replace(
              '{{number}}',
              String(values?.number)
            )
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  Icon: () => null,
  LoadingSvg: () => null,
  EditIconSvg: () => null,
  DropdownArrowSvg: () => null,
  BtcIconSvg: () => null,
  EthIconSvg: () => null,
  WhiteSuccessIconSvg: () => null,
  NetworkIconSvg: () => null,
  KeySvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  TrashIconSvg: () => null,
  LanguageIconSvg: () => null,
  DollarSignIconSvg: () => null,
  HelpIconSvg: () => null,
  LockIconSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Icon: () => null,
  Tooltip: ({ children }: any) => children,
  AccountMenu: () => null,
}));

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
  notificationManager: {
    cleanup: jest.fn(),
    notifyNetworkChange: jest.fn(),
    notifyAccountChange: jest.fn(),
  },
}));
jest.mock('../providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { webcrypto } from 'crypto';
import http from 'http';
import https from 'https';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as sys from 'syscoinjs-lib';

import DAppController from '../DAppController';
import MainController from '../MainController';
import { GeneralMenu } from 'components/Header/Menus/GeneralMenu';
import { NetworkMenu } from 'components/Header/Menus/NetworkMenu';
import ConnectedSites from 'pages/Settings/ConnectedSites';
import { rehydrate as rehydrateDapps } from 'state/dapp';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import { rehydrateStore } from 'state/rehydrate';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  rehydrate as rehydrateGlobal,
  resetLoadingStates,
  setNetworkRuntimeState,
} from 'state/vaultGlobal';
import { INetwork, INetworkType, KeyringAccountType } from 'types/network';
import { ellipsis } from 'utils/format';
import { blacklistService } from 'utils/security/blacklistService';

import { onMessage } from './index';
import { popupPromise } from './popup-promise';
import { getPipelineInstance } from './request-pipeline';
import { MethodRoute, PaliEvents, PaliSyscoinEvents } from './types';

let mockController: any;
const originalChrome = global.chrome;
const originalCrypto = global.crypto;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalResizeObserver = globalThis.ResizeObserver;
const HOST = 'https://type-switch.synthetic.invalid';
const TYPE = KeyringAccountType.HDAccount;
const FAILURE = 'Synthetic type-switch disconnect refusal';
const PASSWORD = 'Synthetic type switch test password!';
const utxoNetwork = {
  kind: INetworkType.Syscoin,
  chainId: 5700,
  slip44: 1,
  currency: 'tsys',
  label: 'Synthetic UTXO',
  url: 'https://utxo.synthetic.invalid',
};
const evmNetwork = {
  kind: INetworkType.Ethereum,
  chainId: 5700,
  slip44: 60,
  currency: 'sys',
  label: 'Synthetic EVM',
  url: 'https://evm.synthetic.invalid',
};
const clone = <T>(value: T): T => structuredClone(value);
describe.each([true, false])(
  'network-type switch permission persistence (from UTXO=%s)',
  (fromUtxo) => {
    const sourceNetwork = fromUtxo ? utxoNetwork : evmNetwork;
    const targetNetwork = fromUtxo ? evmNetwork : utxoNetwork;
    const addressFor = (network: INetwork) =>
      network.kind === INetworkType.Syscoin
        ? 'sys1synthetic'
        : `0x${'11'.repeat(20)}`;
    const runRequest = async () => {
      const pending = onMessage(
        {
          type: 'METHOD_REQUEST',
          data: {
            method: fromUtxo ? 'eth_changeUTXOEVM' : 'sys_changeUTXOEVM',
            params: [{ chainId: 5700 }],
          },
        },
        { url: `${HOST}/page`, tab: { id: 101 } } as any
      );
      // The real coordinator deliberately leaves a 100ms gap before each popup.
      await jest.advanceTimersByTimeAsync(500);
      return pending;
    };
    let wallet: any;
    let records: Record<string, any>;
    let writes: Array<{
      hasGrant: boolean;
      keys: string[];
      previousHasGrant: boolean;
      refused: boolean;
    }>;
    let refuseDisconnect: boolean;
    let storageOutage: boolean;
    let reconnect: 'accept' | 'reject';
    let rejectSwitch: boolean;

    beforeEach(async () => {
      jest.useFakeTimers();
      globalThis.ResizeObserver = class {
        observe() {
          return undefined;
        }
        unobserve() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      } as typeof ResizeObserver;
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
      });
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: async (_name: string, _options: any, callback: () => any) =>
            callback(),
        },
      });
      jest.clearAllMocks();
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(console, 'warn').mockImplementation();
      jest.spyOn(console, 'error').mockImplementation();
      const denyNetwork = () => {
        throw new Error('Synthetic unavailable endpoint; no public network');
      };
      jest.spyOn(http, 'request').mockImplementation(denyNetwork);
      jest.spyOn(http, 'get').mockImplementation(denyNetwork);
      jest.spyOn(https, 'request').mockImplementation(denyNetwork);
      jest.spyOn(https, 'get').mockImplementation(denyNetwork);
      jest.spyOn(globalThis, 'fetch').mockImplementation(denyNetwork);
      jest
        .spyOn(CustomJsonRpcProvider.prototype as any, 'requestRpc')
        .mockImplementation(async (payload: any) =>
          (Array.isArray(payload) ? payload : [payload]).map((request: any) => {
            if (
              !['eth_getBalance', 'eth_blockNumber', 'eth_chainId'].includes(
                request.method
              )
            )
              throw new Error(
                `Unexpected synthetic RPC method: ${request.method}`
              );
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: request.method === 'eth_chainId' ? '0x1644' : '0x0',
            };
          })
        );
      // Keep the SDK's real network-switch/session path. Only the eventual
      // Blockbook response is synthetic, including a complete empty inventory.
      jest
        .spyOn(sys.utils, 'fetchBackendAccount')
        .mockImplementation(async (url: string) => {
          expect(url).toMatch(/^https:\/\/utxo\.synthetic\.invalid\/?$/);
          return {
            address: 'sys1synthetic',
            balance: '0',
            unconfirmedBalance: '0',
            txs: 0,
            unconfirmedTxs: 0,
            tokensAsset: [],
            tokens: [],
          };
        });
      jest.spyOn(blacklistService, 'checkUrl').mockResolvedValue({
        isBlacklisted: false,
      } as any);
      walletPersistenceGate.blocked = false;
      vaultCache.clearCache();
      records = {};
      writes = [];
      refuseDisconnect = false;
      storageOutage = false;
      reconnect = 'accept';
      rejectSwitch = false;
      global.chrome = {
        runtime: { id: 'type-switch-synthetic' },
        storage: {
          local: {
            get: (keys: string[], callback?: (value: any) => void) => {
              const names = Array.isArray(keys) ? keys : [keys];
              const result = Object.fromEntries(
                names
                  .filter((key) => key in records)
                  .map((key) => [key, clone(records[key])])
              );
              if (callback) callback(result);
              else return Promise.resolve(result);
            },
            set: (items: Record<string, any>, callback?: () => void) => {
              if (items.state) {
                const hasGrant = Boolean(items.state.dapp.dapps[HOST]);
                const refused =
                  (refuseDisconnect || storageOutage) && !hasGrant;
                writes.push({
                  hasGrant,
                  keys: Object.keys(items),
                  refused,
                  previousHasGrant: Boolean(records.state?.dapp.dapps[HOST]),
                });
                if (refused) {
                  refuseDisconnect = false;
                  (chrome.runtime as any).lastError = { message: FAILURE };
                  callback?.();
                  delete (chrome.runtime as any).lastError;
                  return;
                }
              }
              Object.assign(records, clone(items));
              if (callback) callback();
              else return Promise.resolve();
            },
          },
        },
        tabs: {
          query: (_query: any, callback: (tabs: any[]) => void) => callback([]),
          onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
          onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
        },
        scripting: { executeScript: jest.fn().mockResolvedValue([]) },
        alarms: { clear: jest.fn(), create: jest.fn() },
      } as any;
      const base = store.getState().vault;
      const groups = (): Record<KeyringAccountType, any> =>
        Object.fromEntries(
          Object.values(KeyringAccountType).map((type) => [type, {}])
        ) as Record<KeyringAccountType, any>;
      const vault = (network: any, address: string) => {
        const accounts = groups();
        accounts[TYPE][0] = {
          id: 0,
          label:
            network.kind === INetworkType.Syscoin
              ? 'UTXO account zero'
              : 'EVM account zero',
          address,
          xpub: `public-${network.kind}`,
          balances: { ethereum: 0, syscoin: 0 },
        };
        const accountAssets = groups();
        accountAssets[TYPE][0] = { ethereum: [], syscoin: [] };
        const accountTransactions = groups();
        accountTransactions[TYPE][0] = { ethereum: {}, syscoin: {} };
        return {
          ...base,
          activeNetwork: network,
          accounts,
          accountAssets,
          accountTransactions,
          activeAccount: { id: 0, type: TYPE },
          isBitcoinBased: network.kind === INetworkType.Syscoin,
        };
      };
      store.dispatch(
        restoreVaultSnapshot(vault(sourceNetwork, addressFor(sourceNetwork)))
      );
      store.dispatch(
        rehydrateGlobal({
          ...store.getState().vaultGlobal,
          activeSlip44: sourceNetwork.slip44,
          networkStatus: 'idle',
          isSwitchingAccount: false,
          networks: {
            syscoin: { 5700: utxoNetwork },
            ethereum: { 5700: evmNetwork },
          },
        } as any)
      );
      store.dispatch(
        rehydrateDapps({
          dapps: {
            [HOST]: {
              host: HOST,
              accountId: 0,
              accountType: TYPE,
              chain: sourceNetwork.kind,
              chainId: 5700,
              ...(fromUtxo
                ? {
                    utxoAccount: {
                      slip44: sourceNetwork.slip44,
                      xpub: `public-${sourceNetwork.kind}`,
                    },
                  }
                : {}),
              date: 1,
            },
          },
        })
      );
      await persistCommittedWalletState(true);
      await vaultCache.setSlip44Vault(
        targetNetwork.slip44,
        vault(targetNetwork, addressFor(targetNetwork)) as any
      );
      wallet = new MainController();
      mockController = {
        wallet,
        dapp: DAppController(
          () => wallet.isUnlocked(),
          () => wallet.getWalletStateGeneration()
        ),
      };
      // Public BIP39 fixture only; initialize an actual SDK session so the real
      // MainController transfers its secure session during the network switch.
      await wallet
        .getActiveKeyring()
        .initializeSession(
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          PASSWORD
        );
      mockController.dapp.setup({ url: `${HOST}/page` });
      jest.mocked(popupPromise).mockImplementation(async (popup) => {
        if (popup.route === MethodRoute.SwitchUtxoEvm) {
          if (rejectSwitch) throw new Error('User rejected network switch');
          await wallet.setActiveNetwork(
            (popup.data as { newNetwork: INetwork }).newNetwork,
            false
          );
          return null;
        }
        expect([MethodRoute.Connect, MethodRoute.ChangeAccount]).toContain(
          popup.route
        );
        if (reconnect === 'reject') throw new Error('User rejected reconnect');
        const state = store.getState().vault;
        const account =
          state.accounts[state.activeAccount.type][state.activeAccount.id];
        const expected = {
          address: account.address,
          xpub: account.xpub,
          network: { ...state.activeNetwork },
        };
        if (popup.route === MethodRoute.ChangeAccount)
          return mockController.dapp.requestPermissions(
            HOST,
            state.activeAccount.id,
            state.activeAccount.type,
            expected
          );
        await mockController.dapp.connect(
          {
            host: HOST,
            ...state.activeAccount,
            accountId: state.activeAccount.id,
            accountType: state.activeAccount.type,
            chain: state.activeNetwork.kind,
            chainId: state.activeNetwork.chainId,
            date: 2,
          },
          expected
        );
        return null;
      });
      writes = [];
    });

    afterEach(async () => {
      for (const keyring of wallet?.keyrings.values() || [])
        await keyring.destroy();
      expect(getPipelineInstance()?.getQueueLength()).toBe(0);
      expect(getPipelineInstance()?.isCurrentlyProcessing()).toBe(false);
      jest.clearAllTimers();
      jest.useRealTimers();
      vaultCache.clearCache();
      jest.restoreAllMocks();
      global.chrome = originalChrome;
      globalThis.ResizeObserver = originalResizeObserver;
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
      if (originalLocks)
        Object.defineProperty(navigator, 'locks', originalLocks);
      else delete (navigator as any).locks;
    });

    const finishScheduledSave = async () => {
      // Execute the real normal post-switch refresh and its 100ms debounced save.
      await jest.advanceTimersByTimeAsync(500);
    };
    const coldAccountRead = async () => {
      for (const keyring of wallet.keyrings.values()) await keyring.destroy();
      jest.clearAllTimers();
      vaultCache.clearCache();
      await rehydrateStore(store);
      // These are the normal cold-background transient-state resets.
      store.dispatch(
        setNetworkRuntimeState({
          isPollingUpdate: false,
          isPostNetworkSwitchLoading: false,
          isSwitchingAccount: false,
          networkStatus: 'idle',
          networkTarget: undefined,
        })
      );
      store.dispatch(resetLoadingStates());
      wallet = new MainController();
      mockController = {
        wallet,
        dapp: DAppController(
          () => wallet.isUnlocked(),
          () => wallet.getWalletStateGeneration()
        ),
      };
      // Real public SDK authentication restores the new worker's session from
      // the encrypted synthetic vault. No controller getter or grant is faked.
      await expect(
        wallet.getActiveKeyring().unlock(PASSWORD)
      ).resolves.toMatchObject({ canLogin: true });
      expect(mockController.dapp.isConnected(HOST)).toBe(
        mockController.dapp.get(HOST)?.chain === targetNetwork.kind
      );
      const snapshot = await onMessage(
        {
          type: 'METHOD_REQUEST',
          data: {
            method: fromUtxo
              ? 'wallet_getProviderState'
              : 'wallet_getSysProviderState',
            params: [],
          },
        },
        { url: `${HOST}/page`, tab: { id: 101 } } as any
      );
      if (!fromUtxo && snapshot.accounts.length === 0)
        expect(snapshot.xpub).toBeNull();
      if (fromUtxo) {
        const accounts = await onMessage(
          {
            type: 'METHOD_REQUEST',
            data: { method: 'eth_accounts', params: [] },
          },
          { url: `${HOST}/page`, tab: { id: 101 } } as any
        );
        expect(accounts).toEqual(snapshot.accounts);
      }
      return snapshot.accounts;
    };

    it('keeps same-family network changes authorized regardless of numeric chain ID', async () => {
      await expect(runRequest()).resolves.toBeNull();
      await wallet.setActiveNetwork({ ...targetNetwork, chainId: 5701 }, false);
      await finishScheduledSave();
      expect(mockController.dapp.isConnected(HOST)).toBe(true);
      expect(mockController.dapp.getAccount(HOST).address).toBe(
        addressFor(targetNetwork)
      );
      expect(mockController.dapp.get(HOST).chainId).toBe(5700);
    });

    it('retains foreign grants for management but neither accounts nor session notifications', async () => {
      chrome.tabs.query = jest.fn((_query, reply: any) =>
        reply([{ id: 101, url: `${HOST}/page` }])
      ) as any;
      await wallet.setActiveNetwork(targetNetwork, false);
      await finishScheduledSave();
      expect(mockController.dapp.get(HOST).chain).toBe(sourceNetwork.kind);
      expect(mockController.dapp.getAll()[HOST]).toBe(
        mockController.dapp.get(HOST)
      );
      expect(mockController.dapp.isConnected(HOST)).toBe(false);
      expect(mockController.dapp.getAccount(HOST)).toBeNull();
      await mockController.dapp.handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: { isUnlocked: true },
      });
      await jest.advanceTimersByTimeAsync(0);
      const notices = () =>
        (chrome.scripting.executeScript as jest.Mock).mock.calls.map(
          ([options]) => JSON.parse(options.args[0]).data
        );
      const accountNotices = notices().filter(
        (data) => data.method === PaliEvents.accountsChanged
      );
      const xpubNotices = notices().filter(
        (data) => data.method === PaliSyscoinEvents.xpubChanged
      );
      expect(accountNotices.length).toBeGreaterThan(0);
      expect(accountNotices.every((data) => data.params.length === 0)).toBe(
        true
      );
      expect(xpubNotices.every((data) => data.params === null)).toBe(true);
      expect(
        notices().find((data) => data.method === PaliEvents.lockStateChanged)
          .params
      ).toEqual({ isUnlocked: true, accounts: [], xpub: null });
      mockController.dapp.setup({ url: `${HOST}/page` });
      (chrome.scripting.executeScript as jest.Mock).mockClear();
      await mockController.dapp.handleStateChange(PaliEvents.accountsChanged, {
        method: PaliEvents.accountsChanged,
        params: [addressFor(targetNetwork)],
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(notices()).toEqual([]);
      await mockController.dapp.disconnect(HOST, true, {
        propagateErrors: true,
      });
      expect(mockController.dapp.get(HOST)).toBeUndefined();
      expect((await loadState()).dapp.dapps[HOST]).toBeUndefined();
    });

    it('does not relabel a retained foreign grant in normally reopened Connected Sites', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(
        React.createElement(
          Provider,
          // createElement supplies the required children in its third argument.
          { store } as React.ComponentProps<typeof Provider>,
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/home'] },
            React.createElement(
              Routes,
              null,
              React.createElement(Route, {
                path: '/home',
                element: React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(GeneralMenu),
                  React.createElement(NetworkMenu)
                ),
              }),
              React.createElement(Route, {
                path: '/settings/networks/connected-sites',
                element: React.createElement(ConnectedSites),
              })
            )
          )
        )
      );
      await user.click(
        screen.getByRole('button', { name: 'settings.connectedSites' })
      );
      await user.click(
        screen.getByRole('button', {
          name: `settings.editConnection: ${HOST}`,
        })
      );
      const sourceDialog = screen.getByRole('dialog');
      expect(
        within(sourceDialog).getByText(ellipsis(addressFor(sourceNetwork)))
      ).toBeVisible();
      expect(
        within(sourceDialog).queryByText(ellipsis(addressFor(targetNetwork)))
      ).toBeNull();
      await user.click(
        within(sourceDialog.querySelector('footer')!).getByRole('button', {
          name: 'buttons.close',
        })
      );
      await act(async () => jest.advanceTimersByTimeAsync(300));
      await user.click(
        within(
          document.querySelector('[data-page-action-footer]') as HTMLElement
        ).getByRole('button', { name: 'buttons.close' })
      );
      await user.click(
        screen.getByRole('button', { name: new RegExp(sourceNetwork.label) })
      );
      await user.click(
        screen.getByRole('menuitem', {
          name: fromUtxo
            ? 'networkMenu.evmNetworks'
            : 'networkMenu.utxoNetworks',
        })
      );
      await act(async () => {
        await user.click(
          screen.getByRole('menuitem', {
            name: targetNetwork.label,
          })
        );
        await finishScheduledSave();
      });
      expect(store.getState().vault.activeNetwork.kind).toBe(
        targetNetwork.kind
      );
      expect(mockController.dapp.getAll()[HOST].chain).toBe(sourceNetwork.kind);
      expect(mockController.dapp.isConnected(HOST)).toBe(false);
      expect(mockController.dapp.getAccount(HOST)).toBeNull();
      await user.click(
        screen.getByRole('button', { name: 'settings.connectedSites' })
      );
      await user.click(
        screen.getByRole('button', {
          name: `settings.editConnection: ${HOST}`,
        })
      );
      const foreignDialog = screen.getByRole('dialog');
      expect(within(foreignDialog).getByText(HOST)).toBeVisible();
      expect(
        within(foreignDialog).queryByText(ellipsis(addressFor(targetNetwork)))
      ).toBeNull();
      expect(within(foreignDialog).getByText('Account 1')).toBeVisible();
      expect(
        within(foreignDialog).getByText('settings.unavailable')
      ).toBeVisible();
      expect(
        within(foreignDialog).getByText(fromUtxo ? 'UTXO' : 'EVM')
      ).toBeVisible();
      await user.click(
        within(foreignDialog).getByRole('button', {
          name: 'settings.deleteConnected',
        })
      );
      await act(async () => jest.advanceTimersByTimeAsync(0));
      expect(mockController.dapp.getAll()[HOST]).toBeUndefined();
      expect((await loadState()).dapp.dapps[HOST]).toBeUndefined();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('requires fresh consent before replacing a retained foreign-family grant', async () => {
      await wallet.setActiveNetwork(targetNetwork, false);
      await finishScheduledSave();
      const originalGrant = mockController.dapp.get(HOST);
      const requestPermission = () =>
        onMessage(
          {
            type: 'METHOD_REQUEST',
            data: {
              method: fromUtxo
                ? 'wallet_requestPermissions'
                : 'sys_requestAccounts',
              params: fromUtxo ? [{ ['eth_accounts']: {} }] : [],
            },
          },
          { url: `${HOST}/page`, tab: { id: 101 } } as any
        );
      reconnect = 'reject';
      const rejected = requestPermission();
      await jest.advanceTimersByTimeAsync(500);
      await expect(rejected).resolves.toMatchObject({ error: {} });
      expect(mockController.dapp.get(HOST)).toBe(originalGrant);
      expect(mockController.dapp.getAccount(HOST)).toBeNull();
      reconnect = 'accept';
      const granted = requestPermission();
      await jest.advanceTimersByTimeAsync(500);
      if (fromUtxo)
        await expect(granted).resolves.toMatchObject([
          {
            parentCapability: 'eth_accounts',
            caveats: [{ value: [addressFor(targetNetwork)] }],
          },
          { parentCapability: 'endowment:permitted-chains' },
        ]);
      else await expect(granted).resolves.toEqual([addressFor(targetNetwork)]);
      expect(mockController.dapp.get(HOST).chain).toBe(targetNetwork.kind);
      expect(mockController.dapp.getAccount(HOST).address).toBe(
        addressFor(targetNetwork)
      );
      expect((await loadState()).dapp.dapps[HOST].chain).toBe(
        targetNetwork.kind
      );
    });

    it('switches and durably reconnects the selected target account', async () => {
      await expect(runRequest()).resolves.toBeNull();
      await finishScheduledSave();
      expect(store.getState().vault.activeNetwork.kind).toBe(
        targetNetwork.kind
      );
      expect(mockController.dapp.getAll()[HOST].chain).toBe(targetNetwork.kind);
      expect((await loadState()).dapp.dapps[HOST].chain).toBe(
        targetNetwork.kind
      );
      expect(popupPromise).toHaveBeenCalledTimes(2);
      expect(writes.some((write) => write.refused)).toBe(false);
      await expect(coldAccountRead()).resolves.toEqual([
        addressFor(targetNetwork),
      ]);
    });

    it('keeps the existing grant and network when switching is rejected', async () => {
      rejectSwitch = true;
      await expect(runRequest()).resolves.toMatchObject({ error: {} });
      await finishScheduledSave();
      expect(store.getState().vault.activeNetwork.kind).toBe(
        sourceNetwork.kind
      );
      expect(mockController.dapp.getAll()[HOST].chain).toBe(sourceNetwork.kind);
      expect((await loadState()).dapp.dapps[HOST].chain).toBe(
        sourceNetwork.kind
      );
      expect(popupPromise).toHaveBeenCalledTimes(1);
    });

    it('lets the real scheduled save repair a refused disconnect after canceled reconnect', async () => {
      refuseDisconnect = true;
      reconnect = 'reject';
      await expect(runRequest()).resolves.toMatchObject({ error: {} });
      await finishScheduledSave();
      expect(writes.filter((write) => write.refused)).toHaveLength(1);
      expect(mockController.dapp.isConnected(HOST)).toBe(false);
      expect((await loadState()).dapp.dapps[HOST]).toBeUndefined();
      // Retain the real write order for the before/final evidence, not a mock
      // replacement of the network save or a claim that the old grant survives it.
      expect(writes.find((write) => write.refused)?.previousHasGrant).toBe(
        true
      );
      expect(writes.at(-1)).toMatchObject({ hasGrant: false, refused: false });
      store.dispatch(rehydrateDapps((await loadState()).dapp));
      const coldDapp = DAppController(() => wallet.isUnlocked());
      expect(coldDapp.isConnected(HOST)).toBe(false);
      await expect(coldAccountRead()).resolves.toEqual([]);
    });

    it('does not restore access to the unapproved target account when disconnect and its repair both fail', async () => {
      storageOutage = true;
      reconnect = 'reject';
      await expect(runRequest()).resolves.toMatchObject({ error: {} });
      await finishScheduledSave();
      expect(popupPromise).toHaveBeenCalledTimes(2);
      expect(
        writes.filter((write) => write.refused).length
      ).toBeGreaterThanOrEqual(2);
      expect(mockController.dapp.isConnected(HOST)).toBe(false);
      expect((await loadState()).dapp.dapps[HOST].chain).toBe(
        sourceNetwork.kind
      );
      expect((await loadState()).vaultGlobal.activeSlip44).toBe(
        targetNetwork.slip44
      );
      storageOutage = false;
      await expect(coldAccountRead()).resolves.toEqual([]);
      expect(popupPromise).toHaveBeenCalledTimes(2);
      // The Ethereum-only permission read is applicable on the EVM target.
      if (fromUtxo) {
        const permissions = await onMessage(
          {
            type: 'METHOD_REQUEST',
            data: { method: 'wallet_getPermissions', params: [] },
          },
          { url: `${HOST}/page`, tab: { id: 101 } } as any
        );
        expect(permissions).toEqual([]);
      }
      reconnect = 'accept';
      const connecting = onMessage(
        {
          type: 'METHOD_REQUEST',
          data: {
            method: fromUtxo ? 'eth_requestAccounts' : 'sys_requestAccounts',
            params: [],
          },
        },
        { url: `${HOST}/page`, tab: { id: 101 } } as any
      );
      await jest.advanceTimersByTimeAsync(500);
      await expect(connecting).resolves.toEqual([addressFor(targetNetwork)]);
      expect(mockController.dapp.get(HOST).chain).toBe(targetNetwork.kind);
      expect((await loadState()).dapp.dapps[HOST].chain).toBe(
        targetNetwork.kind
      );
    });
  }
);
