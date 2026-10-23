/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { getController } from 'scripts/Background';
import DAppController from 'scripts/Background/controllers/DAppController';
import MainController from 'scripts/Background/controllers/MainController';
import { addDApp, rehydrate as rehydrateDapps } from 'state/dapp';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setHasEthProperty } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';

import RemoveEth from './RemoveEth';

const mockEmitter = jest.fn();
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { wallet?: string }) =>
      key === 'settings.setWalletAsDefault'
        ? jest
            .requireActual('../../assets/locales/en.json')
            .settings.setWalletAsDefault.replace(
              '{{wallet}}',
              values?.wallet || ''
            )
        : key,
  }),
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
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
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: () => null,
  PageActionFooter: jest.requireActual(
    'components/PageActionFooter/PageActionFooter'
  ).PageActionFooter,
  DefaultModal: ({ show, title, onClose }: any) =>
    show ? (
      <div role="dialog">
        {title}
        <button onClick={onClose}>Dismiss confirmation</button>
      </div>
    ) : null,
}));

const HOST = 'https://default-wallet-permissions.synthetic.invalid';
const ADDRESS = '0x1111111111111111111111111111111111111111';
const originalChrome = global.chrome;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let records: Record<string, any>;
let refusePermissionWrite: boolean;
let refusalHost: string;
let refuseProviderWrite: boolean;
let stateWrites: any[];
let refusedWrites: any[];
let wallet: any;
let dapp: ReturnType<typeof DAppController>;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  stateWrites = [];
  refusedWrites = [];
  refusePermissionWrite = false;
  refusalHost = HOST;
  refuseProviderWrite = false;
  global.chrome = {
    runtime: { id: 'synthetic-default-wallet' },
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
          if (items.state) stateWrites.push(clone(items.state));
          if (
            refusePermissionWrite &&
            items.state &&
            !items.state.dapp.dapps[refusalHost]
          ) {
            refusePermissionWrite = false;
            refusedWrites.push(clone(items.state));
            (chrome.runtime as any).lastError = {
              message: 'Permission storage unavailable',
            };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          if (
            refuseProviderWrite &&
            items.state?.vaultGlobal.hasEthProperty === false
          ) {
            refuseProviderWrite = false;
            (chrome.runtime as any).lastError = {
              message: 'Provider storage unavailable',
            };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  const vault = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        url: 'https://default-wallet-rpc.synthetic.invalid',
        label: 'Synthetic',
        currency: 'eth',
      },
      isBitcoinBased: false,
      accounts: {
        ...vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            address: ADDRESS,
            xpub: 'public-synthetic-account',
            label: 'Synthetic account',
          },
        },
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setHasEthProperty(true));
  store.dispatch(
    rehydrateDapps({
      dapps: {
        [HOST]: {
          host: HOST,
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          chain: INetworkType.Ethereum,
          chainId: 1,
          date: 1,
        },
      },
    })
  );
  wallet = Object.create(MainController.prototype);
  wallet.ethPropertyMutex = new AsyncMutex();
  wallet.resetAutoLockTimer = jest.fn();
  wallet.walletStateGeneration = 0;
  dapp = DAppController(
    () => true,
    () => wallet.walletStateGeneration
  );
  jest.mocked(getController).mockReturnValue({ wallet, dapp } as any);
  dapp.setup({ url: HOST } as chrome.runtime.MessageSender);
  mockEmitter.mockImplementation(
    async ([namespace, method]: string[], params: any[] = []) => {
      const target = namespace === 'wallet' ? wallet : dapp;
      return target[method](...params);
    }
  );
  await persistCommittedWalletState(true);
  stateWrites = [];
});

afterEach(() => {
  if (wallet.saveTimeout) clearTimeout(wallet.saveTimeout);
  vaultCache.clearCache();
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <RemoveEth />
      </MemoryRouter>
    </Provider>
  );
const disableProvider = async () => {
  fireEvent.click(
    screen.getByRole('button', { name: 'Set Metamask as default wallet' })
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: /Set (Pali|Metamask) as default wallet/,
      })
    ).toBeEnabled()
  );
};
const coldState = async () => {
  const stored = await loadState();
  await act(async () => store.dispatch(rehydrateDapps(stored.dapp)));
  return { stored, controller: DAppController(() => true) };
};

it('persists provider disablement and healthy namespace disconnection through the actual UI', async () => {
  mount();
  await disableProvider();
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'settings.windowObjectWasSet'
  );
  expect(store.getState().vaultGlobal.hasEthProperty).toBe(false);
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(records.state.vaultGlobal.hasEthProperty).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(refusedWrites).toHaveLength(0);
  const cold = await coldState();
  expect(cold.stored.vaultGlobal.hasEthProperty).toBe(false);
  expect(cold.controller.isConnected(HOST)).toBe(false);
});

it('keeps the provider enabled and the grant reviewable when a requested revocation fails', async () => {
  mount();
  refusePermissionWrite = true;
  await disableProvider();
  expect(refusedWrites).toHaveLength(1);
  // Permissions now commit first; a refusal must not disable the retry action.
  // The original failed-before artifact preserves evidence of the old order.
  expect(store.getState().vaultGlobal.hasEthProperty).toBe(true);
  expect(records.state.vaultGlobal.hasEthProperty).toBe(true);
  const observed = {
    reportedSuccess: screen.queryByRole('dialog') !== null,
    livePermission: dapp.isConnected(HOST),
    persistedPermission: Boolean(records.state.dapp.dapps[HOST]),
  };
  expect(observed).toEqual({
    reportedSuccess: false,
    livePermission: true,
    persistedPermission: true,
  });
  expect(screen.getByRole('alert')).toHaveTextContent('send.failed');
  expect(mockEmitter).not.toHaveBeenCalledWith([
    'wallet',
    'removeWindowEthProperty',
  ]);
});

it('an explicit disable after cold restore retries removal of the persisted namespace grant', async () => {
  mount();
  refusePermissionWrite = true;
  await disableProvider();
  const cold = await coldState();
  expect(cold.controller.isConnected(HOST)).toBe(true);
  await disableProvider();
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(refusedWrites).toHaveLength(1);
  expect(
    stateWrites.some(
      (state) => !state.vaultGlobal.hasEthProperty && !state.dapp.dapps[HOST]
    )
  ).toBe(true);
});

it('retries a refused permission write from the same screen without re-enabling the provider', async () => {
  mount();
  refusePermissionWrite = true;
  await disableProvider();
  expect(screen.getByRole('alert')).toHaveTextContent('send.failed');
  await disableProvider();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'settings.windowObjectWasSet'
  );
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(records.state.vaultGlobal.hasEthProperty).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(
    mockEmitter.mock.calls.filter(
      ([methods]) => methods[1] === 'addWindowEthProperty'
    )
  ).toHaveLength(0);
});

it('keeps earlier durable revocations when a later host fails, then retries only remaining grants', async () => {
  const secondHost = 'https://second-default-wallet.synthetic.invalid';
  store.dispatch(addDApp({ ...dapp.get(HOST)!, host: secondHost }));
  await persistCommittedWalletState(true);
  stateWrites = [];
  mount();
  refusalHost = secondHost;
  refusePermissionWrite = true;
  await disableProvider();
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(dapp.isConnected(secondHost)).toBe(true);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(records.state.dapp.dapps[secondHost]).toBeDefined();
  expect(records.state.vaultGlobal.hasEthProperty).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('send.failed');
  mockEmitter.mockClear();
  await disableProvider();
  expect(
    mockEmitter.mock.calls.filter(([methods]) => methods[1] === 'disconnect')
  ).toEqual([
    [
      ['dapp', 'disconnect'],
      [
        secondHost,
        true,
        { propagateErrors: true, allowAlreadyDisconnected: true },
      ],
    ],
  ]);
  expect(records.state.dapp.dapps).toEqual({});
  expect(records.state.vaultGlobal.hasEthProperty).toBe(false);
});

it('does not claim success when the provider preference fails after durable revocations', async () => {
  mount();
  refuseProviderWrite = true;
  await disableProvider();
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(records.state.vaultGlobal.hasEthProperty).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('send.failed');
  expect(screen.queryByRole('dialog')).toBeNull();
  await disableProvider();
  expect(records.state.vaultGlobal.hasEthProperty).toBe(false);
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'settings.windowObjectWasSet'
  );
});

it('enables the provider without revoking existing namespace permissions', async () => {
  store.dispatch(setHasEthProperty(false));
  await persistCommittedWalletState(true);
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Set Pali as default wallet' })
  );
  await screen.findByRole('dialog');
  expect(records.state.vaultGlobal.hasEthProperty).toBe(true);
  expect(records.state.dapp.dapps[HOST]).toBeDefined();
  expect(dapp.isConnected(HOST)).toBe(true);
  expect(mockEmitter.mock.calls).toEqual([
    [['wallet', 'addWindowEthProperty']],
  ]);
});

it('does not revoke a newly approved origin outside the requested disconnect snapshot', async () => {
  const newHost = 'https://new-default-wallet-approval.synthetic.invalid';
  let release!: () => void;
  let started!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const originalSet = chrome.storage.local.set;
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items: any, callback: any) => {
      if (!held && items.state && !items.state.dapp.dapps[HOST]) {
        held = true;
        release = () => originalSet(items, callback);
        started();
      } else originalSet(items, callback);
    });
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Set Metamask as default wallet' })
  );
  await writeStarted;
  const approval = dapp.requestPermissions(
    newHost,
    0,
    KeyringAccountType.HDAccount,
    {
      address: ADDRESS,
      xpub: 'public-synthetic-account',
      network: store.getState().vault.activeNetwork,
    }
  );
  await act(async () => {
    release();
    await approval;
  });
  await screen.findByRole('dialog');
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(dapp.isConnected(newHost)).toBe(true);
  expect(records.state.dapp.dapps[newHost]).toBeDefined();
  expect(records.state.vaultGlobal.hasEthProperty).toBe(false);
  expect(
    mockEmitter.mock.calls.filter(([methods]) => methods[1] === 'disconnect')
  ).toEqual([
    [
      ['dapp', 'disconnect'],
      [HOST, true, { propagateErrors: true, allowAlreadyDisconnected: true }],
    ],
  ]);
});

it('finishes disabling when another view already durably disconnected a later requested host', async () => {
  const secondHost = 'https://already-disconnected.synthetic.invalid';
  store.dispatch(addDApp({ ...dapp.get(HOST)!, host: secondHost }));
  await persistCommittedWalletState(true);
  let release!: () => void;
  let started!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const originalSet = chrome.storage.local.set;
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items: any, callback: any) => {
      if (!held && items.state && !items.state.dapp.dapps[HOST]) {
        held = true;
        release = () => originalSet(items, callback);
        started();
      } else originalSet(items, callback);
    });
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Set Metamask as default wallet' })
  );
  await writeStarted;
  const otherView = dapp.disconnect(secondHost, true, {
    propagateErrors: true,
  });
  await act(async () => {
    release();
    await otherView;
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: /Set (Pali|Metamask) as default wallet/,
      })
    ).toBeEnabled()
  );
  expect(records.state.dapp.dapps).toEqual({});
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'settings.windowObjectWasSet'
  );
  expect(records.state.vaultGlobal.hasEthProperty).toBe(false);
});

it('still revokes a newly approved permission for a host in the clicked global disconnect snapshot', async () => {
  const secondHost = 'https://reapproved-default-wallet.synthetic.invalid';
  store.dispatch(addDApp({ ...dapp.get(HOST)!, host: secondHost }));
  await persistCommittedWalletState(true);
  const oldDate = dapp.get(secondHost)!.date;
  let release!: () => void;
  let started!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const originalSet = chrome.storage.local.set;
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items: any, callback: any) => {
      if (!held && items.state && !items.state.dapp.dapps[HOST]) {
        held = true;
        release = () => originalSet(items, callback);
        started();
      } else originalSet(items, callback);
    });
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Set Metamask as default wallet' })
  );
  await writeStarted;
  let approvedPermission: any;
  const approval = dapp
    .requestPermissions(secondHost, 0, KeyringAccountType.HDAccount, {
      address: ADDRESS,
      xpub: 'public-synthetic-account',
      network: store.getState().vault.activeNetwork,
    })
    .then((permissions) => {
      approvedPermission = permissions[0];
    });
  await act(async () => {
    release();
    await approval;
  });
  await screen.findByRole('dialog');
  expect(approvedPermission.date).not.toBe(oldDate);
  expect(approvedPermission.caveats).toEqual([
    { type: 'restrictReturnedAccounts', value: [ADDRESS] },
  ]);
  expect(
    stateWrites.some(
      (state) => state.dapp.dapps[secondHost]?.date === approvedPermission.date
    )
  ).toBe(true);
  expect(dapp.isConnected(secondHost)).toBe(false);
  expect(records.state.dapp.dapps).toEqual({});
  expect(records.state.vaultGlobal.hasEthProperty).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});
