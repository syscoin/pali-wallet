jest.mock('..', () => ({ getController: jest.fn() }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/vaultCache', () => ({
  __esModule: true,
  default: { emergencySave: jest.fn(), clearCache: jest.fn() },
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('../utils/startPolling', () => ({ startPolling: jest.fn() }));
jest.mock('../handlers/handlePaliUpdates', () => ({
  checkForUpdates: jest.fn(),
}));

import { getController } from '..';
import {
  handleListeners,
  resetListenersFlag,
} from '../handlers/handleListeners';
import { walletPersistenceGate } from 'state/paliStorage';
import store, { saveMainState } from 'state/store';
import { setHasEthProperty, setHasEncryptedVault } from 'state/vaultGlobal';
import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import DAppController from './DAppController';
import MainController from './MainController';

const deferred = () => {
  let resolve: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
};

describe('authoritative Ethereum preference before tab enumeration', () => {
  let wallet: any;
  let receive: (...args: any[]) => any;
  let persist: jest.SpyInstance;
  let persisted: any;

  beforeEach(() => {
    jest.clearAllMocks();
    walletPersistenceGate.blocked = false;
    (chrome as any).alarms = {
      onAlarm: { addListener: jest.fn(), removeListener: jest.fn() },
    };
    (chrome.runtime as any).id = 'fixture-extension';
    (chrome.runtime as any).onConnect = { addListener: jest.fn() };
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    wallet = Object.create(MainController.prototype);
    wallet.ethPropertyMutex = new AsyncMutex();
    const controller = { wallet, dapp: DAppController() };
    (getController as jest.Mock).mockReturnValue(controller);
    resetListenersFlag();
    handleListeners(controller as any);
    receive = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls.at(
      -1
    )[0];
    persisted = undefined;
    persist = jest
      .spyOn(chromeStorage, 'setItem')
      .mockImplementation(async (key, value) => {
        expect(key).toBe('state');
        persisted = value;
      });
  });

  afterEach(() => {
    persist.mockRestore();
    walletPersistenceGate.blocked = false;
  });

  const initializedTab = () => {
    const response = jest.fn();
    receive(
      { type: 'pw-msg-background', action: 'isInjected' },
      {
        id: 'fixture-extension',
        url: 'https://new-tab.example/',
        tab: { id: 2 },
      },
      response
    );
    return response.mock.calls[0][0];
  };

  it.each([true, false])(
    'new tabs see enabled=%s during the pending broadcast, with storage already committed',
    async (enabled) => {
      store.dispatch(setHasEthProperty(!enabled));
      const storage = deferred();
      const queryStarted = deferred();
      const delivery = deferred();
      let enumerate: (tabs: Partial<chrome.tabs.Tab>[]) => void;
      persist.mockImplementation(async (_key, value) => {
        await storage.promise;
        persisted = value;
      });
      (chrome.tabs.query as jest.Mock).mockImplementation(
        (_query, callback) => {
          enumerate = callback;
          queryStarted.resolve();
        }
      );
      (chrome.tabs.sendMessage as jest.Mock).mockReturnValue(delivery.promise);
      const changed =
        wallet[enabled ? 'addWindowEthProperty' : 'removeWindowEthProperty']();
      await new Promise(setImmediate);
      expect(initializedTab().isInjected).toBe(!enabled);
      expect(chrome.tabs.query).not.toHaveBeenCalled();

      storage.resolve();
      await queryStarted.promise;
      enumerate([{ id: 1, url: 'https://existing-tab.example/' }]);
      await new Promise(setImmediate);
      expect(persisted.vaultGlobal.hasEthProperty).toBe(enabled);
      expect(initializedTab().isInjected).toBe(enabled);
      expect(store.getState().dapp.dapps).toEqual({});
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
      delivery.resolve();
      await changed;
    }
  );

  it.each([true, false])(
    'storage rejection leaves enabled=%s unchanged and does not enumerate tabs',
    async (oldValue) => {
      store.dispatch(setHasEthProperty(oldValue));
      persist.mockRejectedValueOnce(new Error('storage unavailable'));
      await expect(
        wallet[oldValue ? 'removeWindowEthProperty' : 'addWindowEthProperty']()
      ).rejects.toThrow('storage unavailable');
      expect(store.getState().vaultGlobal.hasEthProperty).toBe(oldValue);
      expect(initializedTab().isInjected).toBe(oldValue);
      expect(chrome.tabs.query).not.toHaveBeenCalled();
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('does not roll back a committed preference when notification delivery rejects', async () => {
    store.dispatch(setHasEthProperty(false));
    (chrome.tabs.query as jest.Mock).mockImplementation(() => {
      throw new Error('tab enumeration unavailable');
    });
    await expect(wallet.addWindowEthProperty()).rejects.toThrow();
    expect(persisted.vaultGlobal.hasEthProperty).toBe(true);
    expect(store.getState().vaultGlobal.hasEthProperty).toBe(true);
    expect(initializedTab().isInjected).toBe(true);
    expect(store.getState().dapp.dapps).toEqual({});
  });

  it('refuses publication into Redux if recovery starts during pending storage', async () => {
    store.dispatch(setHasEthProperty(false));
    const storage = deferred();
    persist.mockImplementation(async (_key, value) => {
      await storage.promise;
      persisted = value;
    });
    const changed = wallet.addWindowEthProperty();
    const refused = expect(changed).rejects.toThrow(
      'Wallet recovery must finish'
    );
    await new Promise(setImmediate);
    walletPersistenceGate.blocked = true;
    storage.resolve();
    await refused;
    expect(store.getState().vaultGlobal.hasEthProperty).toBe(false);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it('retains concurrent Redux changes and does not cache them as already persisted', async () => {
    store.dispatch(setHasEthProperty(false));
    store.dispatch(setHasEncryptedVault(false));
    const storage = deferred();
    persist.mockImplementation(async (_key, value) => {
      await storage.promise;
      persisted = value;
    });
    const changed = wallet.addWindowEthProperty();
    await new Promise(setImmediate);
    store.dispatch(setHasEncryptedVault(true));
    storage.resolve();
    await changed;
    expect(persisted.vaultGlobal.hasEncryptedVault).toBe(false);
    expect(store.getState().vaultGlobal.hasEncryptedVault).toBe(true);
    await saveMainState();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persisted.vaultGlobal.hasEncryptedVault).toBe(true);
  });

  it('serializes opposite background transitions through completion of their broadcasts', async () => {
    store.dispatch(setHasEthProperty(false));
    const starts = [deferred(), deferred()];
    const delivery = deferred();
    const enumerations: Array<(tabs: Partial<chrome.tabs.Tab>[]) => void> = [];
    (chrome.tabs.query as jest.Mock).mockImplementation((_query, callback) => {
      enumerations.push(callback);
      starts[enumerations.length - 1].resolve();
    });
    (chrome.tabs.sendMessage as jest.Mock).mockReturnValueOnce(
      delivery.promise
    );
    const enable = wallet.addWindowEthProperty();
    await starts[0].promise;
    const disable = wallet.removeWindowEthProperty();
    enumerations[0]([{ id: 1, url: 'https://existing-tab.example/' }]);
    await new Promise(setImmediate);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(initializedTab().isInjected).toBe(true);
    delivery.resolve();
    await enable;
    await starts[1].promise;
    expect(initializedTab().isInjected).toBe(false);
    enumerations[1]([]);
    await disable;
    expect(persist).toHaveBeenCalledTimes(2);
    expect(store.getState().dapp.dapps).toEqual({});
  });
});
