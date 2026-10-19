/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import DAppController from 'scripts/Background/controllers/DAppController';
import { rehydrate as rehydrateDapps } from 'state/dapp';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
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
          if (items.state && failNextStateWrite) {
            failNextStateWrite = false;
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
      accounts: {
        ...vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            address: '0x1111111111111111111111111111111111111111',
            xpub: 'public-only-account',
            label: 'Synthetic account',
          },
        },
      },
    } as any)
  );
  store.dispatch(rehydrateDapps({ dapps: { [HOST]: grant } }));
  await persistMainStateStrict();
  stateWrites = [];
  controller = DAppController(() => true);
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
const removeFromSettings = async () => {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'settings.editConnection' })
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'settings.deleteConnected',
    })
  );
  await waitFor(() => expect(stateWrites).toHaveLength(1));
};
const restorePersistedPermissions = async () => {
  const saved = await loadState();
  await act(async () => store.dispatch(rehydrateDapps(saved.dapp)));
  return DAppController(() => true);
};

it('durably removes a connected site through Settings and keeps it removed on stored-state rehydration', async () => {
  mount();
  await removeFromSettings();
  expect(controller.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect((await restorePersistedPermissions()).isConnected(HOST)).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reports a failed Settings disconnect and allows a durable retry after live permission removal', async () => {
  mount();
  failNextStateWrite = true;
  await removeFromSettings();
  expect(controller.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toEqual(grant);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Permission storage unavailable'
  );
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: `receive.retry: ${HOST}` }));
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
