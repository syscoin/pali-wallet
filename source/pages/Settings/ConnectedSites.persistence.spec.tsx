/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import DAppController from 'scripts/Background/controllers/DAppController';
import { PaliEvents } from 'scripts/Background/controllers/message-handler/types';
import { addDApp, rehydrate as rehydrateDapps } from 'state/dapp';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, {
  persistDappPermissionGrant,
  persistMainStateStrict,
} from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import ConnectedSites from './ConnectedSites';

const mockEmitter = jest.fn();
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('utils/index', () => ({
  ellipsis: (value?: string) => value || '',
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg />,
  EditIconSvg: () => <svg />,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Icon: () => <svg />,
  PageActionFooter: jest.requireActual(
    'components/PageActionFooter/PageActionFooter'
  ).PageActionFooter,
}));

const HOST = 'https://connected-storage.invalid';
const grant = {
  host: HOST,
  accountId: 0,
  accountType: KeyringAccountType.HDAccount,
  chain: INetworkType.Ethereum,
  chainId: 1,
  date: 1,
};
const originalChrome = global.chrome;
const originalResizeObserver = globalThis.ResizeObserver;
let records: Record<string, any>;
let failNextStateWrite: boolean;
let failedStateWritesRemaining: number;
let walletGeneration: number;
let walletUnlocked: boolean;
let controller: ReturnType<typeof DAppController>;
let stateWrites: any[];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

beforeAll(() => {
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
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});
beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  stateWrites = [];
  failNextStateWrite = false;
  failedStateWritesRemaining = 0;
  walletGeneration = 0;
  walletUnlocked = true;
  global.chrome = {
    runtime: { id: 'synthetic-connected-sites' },
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
            items.state &&
            (failNextStateWrite || failedStateWritesRemaining > 0)
          ) {
            failNextStateWrite = false;
            failedStateWritesRemaining = Math.max(
              0,
              failedStateWritesRemaining - 1
            );
            (chrome.runtime as any).lastError = {
              message: 'Permission storage unavailable',
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
  const vault = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        url: 'https://connected-storage-rpc.invalid',
        label: 'Synthetic EVM',
        currency: 'eth',
      },
      isBitcoinBased: false,
      accounts: {
        ...vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            address: '0x1111111111111111111111111111111111111111',
            xpub: 'public-only-account',
            label: 'Synthetic account',
          },
          1: {
            id: 1,
            address: '0x2222222222222222222222222222222222222222',
            xpub: 'public-only-replacement',
            label: 'Replacement account',
          },
        },
      },
    } as any)
  );
  store.dispatch(rehydrateDapps({ dapps: { [HOST]: grant } }));
  await persistMainStateStrict();
  stateWrites = [];
  controller = DAppController(
    () => walletUnlocked,
    () => walletGeneration
  );
  controller.setup({ url: HOST } as chrome.runtime.MessageSender);
  mockEmitter.mockImplementation((methods: string[], params: any[]) => {
    expect(methods).toEqual(['dapp', 'disconnect']);
    return controller.disconnect(...(params as [string, boolean?, any?]));
  });
});
afterEach(() => {
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ConnectedSites />
      </MemoryRouter>
    </Provider>
  );
const removeFromSettings = async (waitForWrite = true) => {
  const previousWrites = stateWrites.length;
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'settings.editConnection' })
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'settings.deleteConnected',
    })
  );
  if (waitForWrite)
    await waitFor(() => expect(stateWrites).toHaveLength(previousWrites + 1));
};
const restorePersistedPermissions = async () => {
  const saved = await loadState();
  await act(async () => store.dispatch(rehydrateDapps(saved.dapp)));
  return DAppController(() => true);
};

const holdNextStateWrite = () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const original = chrome.storage.local.set;
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items: any, callback: any) => {
      if (items.state && !held) {
        held = true;
        release = () => original(items, callback);
        entered();
      } else original(items, callback);
    });
  return { started, release: () => release() };
};

const reconnect = () => {
  const account = store.getState().vault.accounts.HDAccount[1];
  return controller.connect(
    { ...grant, accountId: 1, date: 2 },
    {
      address: account.address,
      xpub: account.xpub,
      network: store.getState().vault.activeNetwork,
    }
  );
};

it('durably removes a connected site through Settings and keeps it removed on stored-state rehydration', async () => {
  mount();
  await removeFromSettings();
  expect(controller.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect((await restorePersistedPermissions()).isConnected(HOST)).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reports a failed Settings disconnect and keeps the permission reviewable for a durable retry', async () => {
  mount();
  failNextStateWrite = true;
  await removeFromSettings();
  expect(controller.isConnected(HOST)).toBe(true);
  expect(records.state.dapp.dapps[HOST]).toEqual(grant);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
  await removeFromSettings();
  await waitFor(() => expect(stateWrites).toHaveLength(2));
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect((await restorePersistedPermissions()).isConnected(HOST)).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not silently acknowledge storage failure when a cold permission restore retains the grant', async () => {
  mount();
  failNextStateWrite = true;
  await removeFromSettings();
  const result = mockEmitter.mock.results[0].value as Promise<unknown>;
  await expect(result).rejects.toMatchObject({
    message: 'Permission storage unavailable',
  });
  expect((await restorePersistedPermissions()).isConnected(HOST)).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
});

it('keeps a failed removal reviewable after closing and reopening Settings', async () => {
  const page = mount();
  failNextStateWrite = true;
  await removeFromSettings();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
  page.unmount();
  mount();
  expect(
    screen.getByRole('button', { name: 'settings.editConnection' })
  ).toBeVisible();
  expect(controller.isConnected(HOST)).toBe(true);
  expect(records.state.dapp.dapps[HOST]).toEqual(grant);
  await removeFromSettings();
  expect(controller.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect((await restorePersistedPermissions()).isConnected(HOST)).toBe(false);
});

it('does not offer an old retry that can revoke a newly approved connection', async () => {
  mount();
  failNextStateWrite = true;
  await removeFromSettings();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
  const account = store.getState().vault.accounts.HDAccount[0];
  await act(async () => {
    await controller.connect(
      { ...grant, date: 2 },
      {
        address: account.address,
        xpub: account.xpub,
        network: store.getState().vault.activeNetwork,
      }
    );
  });
  expect(
    screen.getByRole('button', { name: 'settings.editConnection' })
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: `receive.retry: ${HOST}` })
  ).toBeNull();
  expect(controller.isConnected(HOST)).toBe(true);
  expect(records.state.dapp.dapps[HOST].date).toBe(2);
});

it.each(['success', 'failure', 'cancel'] as const)(
  'keeps failed revocation recoverable when a queued replacement ends in %s',
  async (outcome) => {
    const page = mount();
    const held = holdNextStateWrite();
    await removeFromSettings(false);
    await held.started;
    expect(controller.isConnected(HOST)).toBe(false);
    const replacement = reconnect().then(
      () => ({ ok: true }),
      () => ({ ok: false })
    );
    if (outcome === 'cancel') {
      await controller.disconnect(HOST, false, {
        allowAlreadyDisconnected: true,
      });
    }
    failedStateWritesRemaining = outcome === 'failure' ? 2 : 1;
    await act(async () => {
      held.release();
      await replacement;
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Permission storage unavailable'
    );
    expect((await replacement).ok).toBe(outcome === 'success');
    page.unmount();
    mount();
    expect(
      screen.getByRole('button', { name: 'settings.editConnection' })
    ).toBeVisible();
    const expectedDate = outcome === 'success' ? 2 : 1;
    const expectedAccountId = outcome === 'success' ? 1 : 0;
    expect(controller.get(HOST)?.date).toBe(expectedDate);
    expect(controller.get(HOST)?.accountId).toBe(expectedAccountId);
    expect(records.state.dapp.dapps[HOST].date).toBe(expectedDate);
    expect(records.state.dapp.dapps[HOST].accountId).toBe(expectedAccountId);
    expect((await restorePersistedPermissions()).isConnected(HOST)).toBe(true);
  }
);

it('restores a refused removal before a queued ordinary save snapshots state', async () => {
  mount();
  const held = holdNextStateWrite();
  await removeFromSettings(false);
  await held.started;
  const saving = persistMainStateStrict();
  failNextStateWrite = true;
  await act(async () => {
    held.release();
    await saving;
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
  expect(controller.get(HOST)).toEqual(grant);
  expect(records.state.dapp.dapps[HOST]).toEqual(grant);
});

it('never restores the old permission into a replacement wallet after a delayed failure', async () => {
  mount();
  const held = holdNextStateWrite();
  await removeFromSettings(false);
  await held.started;
  walletGeneration += 1;
  await act(async () => {
    store.dispatch(rehydrateDapps({ dapps: {} }));
  });
  failNextStateWrite = true;
  await act(async () => {
    held.release();
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
  expect(controller.isConnected(HOST)).toBe(false);
  expect(
    screen.queryByRole('button', { name: 'settings.editConnection' })
  ).toBeNull();
});

it('never lets a restored predecessor replace an original nonempty predecessor', async () => {
  const original = controller.get(HOST)!;
  const replacement = { ...original, date: 3 };
  store.dispatch(addDApp(replacement));
  await expect(
    persistDappPermissionGrant(
      { ...grant, date: 4 },
      original,
      () => true,
      () => replacement
    )
  ).rejects.toThrow('Permission grant context changed');
  expect(controller.get(HOST)).toBe(replacement);
  expect(stateWrites).toHaveLength(0);
});

it('captures a restored predecessor once and refuses an equal-fields clone during its write', async () => {
  const original = controller.get(HOST)!;
  const held = holdNextStateWrite();
  let restored = original;
  const writing = persistDappPermissionGrant(
    { ...grant, date: 4 },
    undefined,
    () => true,
    () => restored
  );
  const rejected = expect(writing).rejects.toThrow(
    'Permission grant context changed'
  );
  await held.started;
  restored = { ...original };
  store.dispatch(addDApp(restored));
  held.release();
  await rejected;
  expect(controller.get(HOST)).toBe(restored);
  expect(records.state.dapp.dapps[HOST]).toEqual(restored);
});

it.each([false, true])(
  'delivers lock state with no account disclosure when a revoke write is pending=%s',
  async (pending) => {
    mount();
    const held = pending ? holdNextStateWrite() : undefined;
    if (held) {
      await removeFromSettings(false);
      await held.started;
      expect(controller.isConnected(HOST)).toBe(false);
    }
    (chrome.tabs.query as unknown as jest.Mock).mockImplementation(
      (_query, callback: any) => callback([{ id: 1, url: `${HOST}/app` }])
    );
    walletUnlocked = false;
    await act(async () => {
      await controller.handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: { isUnlocked: false },
      });
    });
    const notices = jest
      .mocked(chrome.scripting.executeScript)
      .mock.calls.map(([details]: any) => details.args[0].data);
    if (held) {
      failNextStateWrite = true;
      await act(async () => {
        held.release();
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Permission storage unavailable'
      );
      expect(controller.isConnected(HOST)).toBe(true);
      expect(records.state.dapp.dapps[HOST]).toEqual(grant);
    }
    expect(notices).toContainEqual({
      method: PaliEvents.lockStateChanged,
      params: { isUnlocked: false, accounts: [], xpub: null },
    });
  }
);

it('does not disclose unlock or account notifications to a pending revoked origin', async () => {
  mount();
  const held = holdNextStateWrite();
  await removeFromSettings(false);
  await held.started;
  (chrome.tabs.query as unknown as jest.Mock).mockImplementation(
    (_query, callback: any) => callback([{ id: 1, url: `${HOST}/app` }])
  );
  await act(async () => {
    await controller.handleStateChange(PaliEvents.lockStateChanged, {
      method: PaliEvents.lockStateChanged,
      params: { isUnlocked: true },
    });
    await controller.handleStateChange(PaliEvents.accountsChanged, {
      method: PaliEvents.accountsChanged,
      params: ['0x2222222222222222222222222222222222222222'],
    });
  });
  const calls = jest.mocked(chrome.scripting.executeScript).mock.calls.length;
  failNextStateWrite = true;
  await act(async () => {
    held.release();
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
  expect(calls).toBe(0);
  expect(controller.isConnected(HOST)).toBe(true);
});

it.each([false, true])(
  'delivers public network metadata when a revoke write is pending=%s',
  async (pending) => {
    mount();
    const held = pending ? holdNextStateWrite() : undefined;
    if (held) {
      await removeFromSettings(false);
      await held.started;
    }
    (chrome.tabs.query as unknown as jest.Mock).mockImplementation(
      (_query, callback: any) => callback([{ id: 1, url: `${HOST}/app` }])
    );
    await act(async () => {
      store.dispatch(
        restoreVaultSnapshot({
          ...store.getState().vault,
          activeNetwork: {
            ...store.getState().vault.activeNetwork,
            chainId: 2,
          },
        })
      );
      await controller.handleStateChange(PaliEvents.chainChanged, {
        method: PaliEvents.chainChanged,
        params: { chainId: '0x2', networkVersion: 2, isBitcoinBased: false },
      });
      await controller.handleStateChange(PaliEvents.isBitcoinBased, {
        method: PaliEvents.isBitcoinBased,
        params: { isBitcoinBased: false },
      });
    });
    const notices = jest
      .mocked(chrome.scripting.executeScript)
      .mock.calls.map(([details]: any) => details.args[0].data);
    if (held) {
      failNextStateWrite = true;
      await act(async () => {
        held.release();
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Permission storage unavailable'
      );
      expect(controller.isConnected(HOST)).toBe(true);
    }
    expect(notices).toEqual([
      {
        method: PaliEvents.chainChanged,
        params: { chainId: '0x2', networkVersion: 2, isBitcoinBased: false },
      },
      { method: PaliEvents.isBitcoinBased, params: { isBitcoinBased: false } },
    ]);
  }
);

it('does not notify a completed revoked origin of later lock or public network changes', async () => {
  mount();
  await removeFromSettings();
  (chrome.scripting.executeScript as jest.Mock).mockClear();
  (chrome.tabs.query as unknown as jest.Mock).mockImplementation(
    (_query, callback: any) => callback([{ id: 1, url: `${HOST}/app` }])
  );
  await act(async () => {
    await controller.handleStateChange(PaliEvents.lockStateChanged, {
      method: PaliEvents.lockStateChanged,
      params: { isUnlocked: false },
    });
    await controller.handleStateChange(PaliEvents.chainChanged, {
      method: PaliEvents.chainChanged,
      params: { chainId: '0x2', networkVersion: 2, isBitcoinBased: false },
    });
    await controller.handleStateChange(PaliEvents.isBitcoinBased, {
      method: PaliEvents.isBitcoinBased,
      params: { isBitcoinBased: false },
    });
  });
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});
