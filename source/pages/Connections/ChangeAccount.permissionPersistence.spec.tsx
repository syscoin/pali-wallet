/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import DAppController from 'scripts/Background/controllers/DAppController';
import MainController from 'scripts/Background/controllers/MainController';
import { rehydrate as rehydrateDapp } from 'state/dapp';
import { walletPersistenceGate } from 'state/paliStorage';
import { rehydrateStore } from 'state/rehydrate';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';

import { ChangeAccount } from './ChangeAccount';

const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
let mockQuery: any;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [null, jest.fn()],
  }),
}));
jest.mock('state/vault/selectors', () => {
  const empty = {};
  return { selectAccountAssets: () => empty };
});
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: 'account-balance',
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: 'loading' }));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Icon: 'icon',
  IconButton: 'button',
  Tooltip: 'tooltip',
}));
jest.mock('components/Loading/ListLoadMore', () => ({
  ListLoadMore: 'load-more',
}));
jest.mock('components/TokenIcon', () => ({ TokenIconStack: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/index'),
  ellipsis: (value: string) => value,
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
// This helper only services unrelated Syscoin transaction-signing methods.
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(() => ({ dapp: { disconnect: jest.fn() } })),
  notificationManager: {
    notifyAccountChange: jest.fn(),
    notifyNetworkChange: jest.fn(),
  },
}));
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/message-handler/provider-cache',
  () => ({
    clearProviderCache: jest.fn(),
  })
);

const type = KeyringAccountType.HDAccount;
const host = 'https://durability.synthetic.invalid';
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const account = (id: number) => ({
  id,
  address: '0x' + String(id + 1).repeat(40),
  xpub: 'public-synthetic-' + id,
  label: 'Account ' + id,
  balances: { ethereum: 1 },
  assets: { ethereum: [], syscoin: [] },
});
let records: Record<string, any>;
let writes: Record<string, any>[];
let wallet: any;
let dapp: any;
let releasePermission: () => void;
let releaseNetwork: () => void;
let sessionAlive: boolean;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  records = {};
  writes = [];
  sessionAlive = true;
  global.chrome = {
    runtime: {
      id: 'synthetic',
      sendMessage: jest.fn(),
      getURL: (v: string) => v,
    },
    tabs: { query: jest.fn((_query, callback) => callback([])) },
    scripting: { executeScript: jest.fn(async () => []) },
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
          writes.push(clone(items));
          Object.assign(records, clone(items));
          callback();
        },
        remove: (keys: string[], callback: any) => {
          for (const key of keys) delete records[key];
          callback();
        },
      },
    },
  } as any;
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  store.dispatch(rehydrateDapp({ dapps: {} } as any));
  store.dispatch(setActiveSlip44(60));
  const old = clone(store.getState().vault);
  store.dispatch(
    restoreVaultSnapshot({
      ...old,
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        slip44: 60,
        label: 'Synthetic A',
        currency: 'eth',
        url: 'https://network-a.synthetic.invalid',
      },
      activeAccount: { id: 0, type },
      isBitcoinBased: false,
      accounts: { ...old.accounts, [type]: { 0: account(0), 1: account(1) } },
    } as any)
  );
  await persistCommittedWalletState(true, false);
  writes.length = 0;
  mockQuery = {
    approvalId: 'same-approval',
    host,
    eventName: 'requestPermissions',
    currentAccountId: 1,
    currentAccountType: type,
  };
  dapp = DAppController(() => true);
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 10,
    assetUpdateRequestId: 20,
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    cancellablePromises: {},
    resetAutoLockTimer: jest.fn(),
    performPostAccountSwitchOperations: jest.fn().mockResolvedValue(undefined),
    setFiat: jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseNetwork = resolve;
        })
    ),
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
    handleStateChange: jest.fn(),
    isNetworkSwitchMainStateDirty: false,
  });
  const responseDelay = new Promise<void>((resolve) => {
    releasePermission = resolve;
  });
  mockEmitter.mockImplementation((path: string[], args: any[]) => {
    if (path[0] === 'dapp' && path[1] === 'requestPermissions') {
      const response = dapp.requestPermissions(...args);
      return responseDelay.then(() => response);
    }
    if (path[0] === 'wallet' && path[1] === 'setAccount')
      return wallet.setAccount(...args);
    throw new Error('Unexpected controller method: ' + path.join('.'));
  });
});
afterEach(async () => {
  // Model worker termination by invalidating any pending old network session.
  sessionAlive = false;
  releaseNetwork?.();
  await Promise.resolve();
  if (wallet.saveTimeout) clearTimeout(wallet.saveTimeout);
  jest.restoreAllMocks();
});

const mountAndSubmit = async () => {
  const view = render(
    <Provider store={store}>
      <ChangeAccount />
    </Provider>
  );
  await act(async () => {
    fireEvent.click(screen.getByText('buttons.confirm'));
  });
  expect(store.getState().dapp.dapps[host].accountId).toBe(1);
  return view;
};

const restoreDurableState = async () => {
  sessionAlive = false;
  vaultCache.clearCache();
  store.dispatch(rehydrateDapp({ dapps: {} } as any));
  await rehydrateStore(store, undefined, undefined, false);
  return DAppController(() => true);
};

it('healthy unchanged approval saves the grant through real setAccount and survives real restoration', async () => {
  const view = await mountAndSubmit();
  await act(async () => {
    releasePermission();
  });
  expect(mockEmitter.mock.calls.map(([path]) => path)).toEqual([
    ['dapp', 'requestPermissions'],
    ['wallet', 'setAccount'],
  ]);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(records.state.dapp.dapps[host].accountId).toBe(1);
  expect(writes.some((write) => write.state && write['state-vault-60'])).toBe(
    true
  );
  view.unmount();
  await restoreDurableState();
  expect(store.getState().dapp.dapps[host].accountId).toBe(1);
});

it('successful delayed approval survives same-slip network replacement before update completion', async () => {
  const view = await mountAndSubmit();
  expect(records.state.dapp.dapps[host].accountId).toBe(1);
  const writesBeforeNetwork = writes.length;
  // Keep the real network-success state transition, reconciliation, and storage
  // barrier. Only the external fiat/update completion is held, like a slow RPC.
  const next = {
    ...store.getState().vault.activeNetwork,
    chainId: 2,
    label: 'Synthetic B',
    url: 'https://network-b.synthetic.invalid',
  };
  await act(async () => {
    await wallet.handleNetworkChangeSuccess(
      next,
      false,
      60,
      () => sessionAlive
    );
  });
  expect(store.getState().vault.activeNetwork.chainId).toBe(2);
  expect(wallet.setFiat).toHaveBeenCalledTimes(1);
  expect(writes).toHaveLength(writesBeforeNetwork + 1);
  expect(writes.at(-1)['state-vault-60']).toBeDefined();
  expect(writes.at(-1).state).toBeUndefined();
  await act(async () => {
    releasePermission();
  });
  expect(mockEmitter.mock.calls.map(([path]) => path)).toEqual([
    ['dapp', 'requestPermissions'],
  ]);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'requestPermissions.' + host,
    expect.arrayContaining([
      expect.objectContaining({ parentCapability: 'eth_accounts' }),
    ])
  );
  expect(window.close).not.toHaveBeenCalled();
  view.unmount();
  await restoreDurableState();
  // No subsequent main-state save occurred after the network replacement.
  // The permission operation itself must already have made this grant durable.
  expect(store.getState().dapp.dapps[host]?.accountId).toBe(1);
});

it('mitigation control: emergencySave after the same delayed approval makes the grant durable', async () => {
  const view = await mountAndSubmit();
  const next = {
    ...store.getState().vault.activeNetwork,
    chainId: 2,
    label: 'Synthetic B',
    url: 'https://network-b.synthetic.invalid',
  };
  await act(async () => {
    await wallet.handleNetworkChangeSuccess(
      next,
      false,
      60,
      () => sessionAlive
    );
    releasePermission();
  });
  expect(mockEmitter.mock.calls.map(([path]) => path)).toEqual([
    ['dapp', 'requestPermissions'],
  ]);
  await vaultCache.emergencySave();
  expect(records.state.dapp.dapps[host].accountId).toBe(1);
  view.unmount();
  await restoreDurableState();
  expect(store.getState().dapp.dapps[host].accountId).toBe(1);
});
