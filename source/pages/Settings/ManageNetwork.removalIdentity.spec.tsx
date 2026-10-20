/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import ManageNetwork from 'pages/Settings/ManageNetwork';
import { getController } from 'scripts/Background';
import MainController from 'scripts/Background/controllers/MainController';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setNetworks,
  setNetworkStatus,
  setIsSwitchingAccount,
} from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';

jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
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
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      key === 'settings.confirmRemoveNetwork'
        ? `Remove ${values.networkName}?`
        : key,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
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
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  Icon: () => null,
  MdBugReport: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  IconButton: ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Icon: ({ name }: any) => <span>{name}</span>,
  Tooltip: ({ children }: any) => children,
  ConfirmationModal: jest.requireActual('components/Modal/Modal')
    .ConfirmationModal,
}));
jest.mock('utils/index', () => ({ truncate: (value: string) => value }));

const mockAlert = { error: jest.fn() };
const mockEmitter = jest.fn();
const source: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Active public fixture',
  currency: 'eth',
  url: 'https://active.synthetic.invalid',
  default: false,
};
const target: INetwork = {
  ...source,
  chainId: 31337,
  label: 'Original approved registration',
  url: 'https://target.synthetic.invalid',
};
const replacement: INetwork = {
  ...target,
  label: 'New registration from second window',
  explorer: 'https://replacement-explorer.synthetic.invalid',
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const originalChrome = global.chrome;
const originalResizeObserver = global.ResizeObserver;
let records: Record<string, any>;
let wallet: any;
let nativeWrites: any[];
const current = () => store.getState().vaultGlobal.networks.ethereum[31337];
const saved = async () =>
  (await loadState()).vaultGlobal.networks.ethereum[31337];
const remove = (network: INetwork) =>
  wallet.removeKeyringNetwork(
    network.kind,
    network.chainId,
    network.url,
    network.label,
    networkRegistrationFingerprint(network),
    network.key
  );

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  records = {};
  nativeWrites = [];
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
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  global.chrome = {
    runtime: { id: 'synthetic-network-removal-confirmation' },
    storage: {
      local: {
        get: (keys: string[], done: (result: any) => void) =>
          done(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: any, done: () => void) => {
          nativeWrites.push(clone(items));
          Object.assign(records, clone(items));
          done();
        },
        remove: (keys: string[], done: () => void) => {
          keys.forEach((key) => delete records[key]);
          done();
        },
      },
    },
  } as any;
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: source,
      isBitcoinBased: false,
    })
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setNetworkStatus('idle'));
  store.dispatch(setIsSwitchingAccount(false));
  store.dispatch(
    setNetworks({ ethereum: { 1: source, 31337: target }, syscoin: {} })
  );
  wallet = Object.create(MainController.prototype);
  wallet.walletStateGeneration = 0;
  wallet.walletSessionGeneration = 0;
  wallet.isRemovingNetwork = false;
  wallet.keyrings = new Map();
  wallet.resetAutoLockTimer = jest.fn();
  wallet.evmAssetsController = {
    detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
  };
  mockEmitter.mockImplementation(async ([area, method], args) => {
    if (area !== 'wallet' || method !== 'removeKeyringNetwork')
      throw new Error('Unexpected synthetic IPC');
    return wallet.removeKeyringNetwork(...args);
  });
  await persistCommittedWalletState(true);
});

afterEach(() => {
  cleanup();
  global.chrome = originalChrome;
  global.ResizeObserver = originalResizeObserver;
  vaultCache.clearCache();
  jest.restoreAllMocks();
});

const openConfirmation = async () => {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings/networks/edit']}>
        <ManageNetwork />
      </MemoryRouter>
    </Provider>
  );
  const row = screen.getByText(target.label).closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'trash' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(`Remove ${target.label}?`);
  return dialog;
};

const replaceFromSecondWindow = async (next: INetwork) => {
  await act(async () => {
    await remove(target);
    await wallet.addCustomRpc(next);
  });
  expect(current()).toEqual(next);
  expect(await saved()).toEqual(next);
};

it('healthy: ordinary current confirmation durably removes its inactive registration', async () => {
  const dialog = await openConfirmation();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  await waitFor(() => expect(current()).toBeUndefined());
  expect(await saved()).toBeUndefined();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(store.getState().vault.activeNetwork).toEqual(source);
});

it('healthy: cancellation does not change the inactive registry', async () => {
  const dialog = await openConfirmation();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.cancel' })
  );
  expect(current()).toEqual(target);
  expect(await saved()).toEqual(target);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('healthy: a different-URL replacement rejects the stale confirmation', async () => {
  const dialog = await openConfirmation();
  const next = { ...replacement, url: 'https://different.synthetic.invalid' };
  await replaceFromSecondWindow(next);
  expect(dialog).toHaveTextContent(`Remove ${target.label}?`);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      'settings.networkRemovalIncomplete'
    )
  );
  expect(current()).toEqual(next);
  expect(await saved()).toEqual(next);
});

it('same-URL replacement must survive a confirmation that still names the old registration', async () => {
  const dialog = await openConfirmation();
  await replaceFromSecondWindow(replacement);
  expect(dialog).toHaveTextContent(`Remove ${target.label}?`);
  expect(dialog).not.toHaveTextContent(replacement.label);
  const writesBeforeConfirmation = nativeWrites.length;
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await act(async () => {
    await expect(mockEmitter.mock.results[0].value).rejects.toThrow(
      'Network changed'
    );
  });
  expect(mockAlert.error).toHaveBeenCalledWith(
    'settings.networkRemovalIncomplete'
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'removeKeyringNetwork'],
    [
      target.kind,
      target.chainId,
      target.url,
      target.label,
      networkRegistrationFingerprint(target),
      undefined,
    ]
  );
  expect(store.getState().vault.activeNetwork).toEqual(source);
  expect({
    live: current() ?? null,
    saved: (await saved()) ?? null,
    newNativeWrites: nativeWrites.length - writesBeforeConfirmation,
  }).toEqual({ live: replacement, saved: replacement, newNativeWrites: 0 });
});

it('healthy: opening a fresh confirmation after replacement removes that displayed registration', async () => {
  await replaceFromSecondWindow(replacement);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings/networks/edit']}>
        <ManageNetwork />
      </MemoryRouter>
    </Provider>
  );
  const row = screen.getByText(replacement.label).closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'trash' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(`Remove ${replacement.label}?`);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  await waitFor(() => expect(current()).toBeUndefined());
  expect(await saved()).toBeUndefined();
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('rejects a same-URL replacement delivered after the old confirmation was clicked', async () => {
  const dialog = await openConfirmation();
  let deliver!: () => void;
  const delivery = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  mockEmitter.mockImplementation(async ([, method], args) => {
    expect(method).toBe('removeKeyringNetwork');
    await delivery;
    return wallet.removeKeyringNetwork(...args);
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await replaceFromSecondWindow(replacement);
  const writesBeforeDelivery = nativeWrites.length;
  await act(async () => {
    deliver();
  });
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      'settings.networkRemovalIncomplete'
    )
  );
  expect(current()).toEqual(replacement);
  expect(await saved()).toEqual(replacement);
  expect(nativeWrites).toHaveLength(writesBeforeDelivery);
});

it('rejects an old confirmation after a same-URL metadata edit through the public controller', async () => {
  const dialog = await openConfirmation();
  const edited = { ...target, explorer: replacement.explorer };
  await act(async () =>
    wallet.editCustomRpc(edited, networkRegistrationFingerprint(target))
  );
  expect(current()).toEqual(edited);
  const writesBeforeConfirmation = nativeWrites.length;
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      'settings.networkRemovalIncomplete'
    )
  );
  expect(current()).toEqual(edited);
  expect(await saved()).toEqual(edited);
  expect(nativeWrites).toHaveLength(writesBeforeConfirmation);
});

it.each([undefined, null, '', 'unrelated-registration'])(
  'rejects invalid removal intent %p before writes',
  async (intent) => {
    const writesBefore = nativeWrites.length;
    await expect(
      wallet.removeKeyringNetwork(
        target.kind,
        target.chainId,
        target.url,
        target.label,
        intent
      )
    ).rejects.toThrow('Network changed');
    expect(current()).toEqual(target);
    expect(await saved()).toEqual(target);
    expect(nativeWrites).toHaveLength(writesBefore);
    expect(wallet.resetAutoLockTimer).not.toHaveBeenCalled();
  }
);

it('keeps built-in defaults without a removal control', () => {
  const builtIn = {
    ...target,
    chainId: 2,
    label: 'Built-in fixture',
    default: true,
  };
  store.dispatch(
    setNetworks({
      ethereum: { 1: source, 2: builtIn, 31337: target },
      syscoin: {},
    })
  );
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings/networks/edit']}>
        <ManageNetwork />
      </MemoryRouter>
    </Provider>
  );
  const row = screen.getByText(builtIn.label).closest('li')!;
  expect(within(row).queryByRole('button', { name: 'trash' })).toBeNull();
});

it('keeps the active network removal control disabled', () => {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings/networks/edit']}>
        <ManageNetwork />
      </MemoryRouter>
    </Provider>
  );
  const row = screen.getByText(source.label).closest('li')!;
  expect(within(row).getByRole('button', { name: 'trash' })).toBeDisabled();
});

it('removes a healthy inactive UTXO registration with its explicit fingerprint', async () => {
  const utxo: INetwork = {
    chainId: 11111,
    kind: INetworkType.Syscoin,
    slip44: 111,
    label: 'UTXO public fixture',
    currency: 'test',
    url: 'https://utxo.synthetic.invalid',
    default: false,
  };
  await wallet.addCustomRpc(utxo);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings/networks/edit']}>
        <ManageNetwork />
      </MemoryRouter>
    </Provider>
  );
  const row = screen.getByText(utxo.label).closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'trash' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Remove UTXO public fixture?');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  await waitFor(() =>
    expect(store.getState().vaultGlobal.networks.syscoin[11111]).toBeUndefined()
  );
  expect(
    (await loadState()).vaultGlobal.networks.syscoin[11111]
  ).toBeUndefined();
  expect(store.getState().vault.activeNetwork).toEqual(source);
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('retires a held durable removal when the real public lock changes the session', async () => {
  const originalSet = chrome.storage.local.set;
  let release!: () => void;
  let entered!: () => void;
  let held = false;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      if (items.state && !held) {
        held = true;
        const snapshot = clone(items);
        release = () => originalSet(snapshot, callback);
        entered();
      } else originalSet(items, callback);
    });
  const pending = remove(target);
  const rejected = expect(pending).rejects.toThrow('Wallet session changed');
  await started;
  expect(current()).toEqual(target);
  // The real lock method owns session invalidation. Only unrelated timer,
  // keyring and dapp-notification effects are synthetic in this no-key fixture.
  wallet.fiatQuoteGeneration = 0;
  wallet.networkRequestGeneration = 0;
  wallet.clearAllTimers = jest.fn();
  wallet.lockAllKeyrings = jest.fn();
  wallet.stopAutoLockTimer = jest.fn().mockResolvedValue(undefined);
  wallet.stopAllRapidPolling = jest.fn();
  (getController as jest.Mock).mockReturnValue({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  });
  wallet.lock();
  expect(wallet.walletSessionGeneration).toBe(1);
  release();
  await rejected;
  expect(current()).toEqual(target);
  expect(await saved()).toEqual(target);
  expect(wallet.isRemovingNetwork).toBe(false);
});
