jest.mock('..', () => ({
  getController: () => ({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  }),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/slhDsa', () => ({
  ...jest.requireActual('utils/slhDsa'),
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
  clearSLHDSAPublicPrecomputeCache: jest.fn().mockResolvedValue(undefined),
  clearSLHDSAXmssTreeCache: jest.fn().mockResolvedValue(undefined),
}));

import { walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setAdvancedSettings } from 'state/vaultGlobal';
import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

describe('advanced settings durable completion and auto-lock timers', () => {
  let wallet: any;
  let persisted: Record<string, any>;
  let writes: jest.SpyInstance;
  let ordinaryWrites: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    walletPersistenceGate.blocked = false;
    store.dispatch(setActiveSlip44(57));
    store.dispatch(
      setAdvancedSettings({ advancedProperty: 'refresh', value: false })
    );
    store.dispatch(
      setAdvancedSettings({ advancedProperty: 'autolock', value: 5 })
    );
    persisted = { state: structuredClone(store.getState()) };
    ordinaryWrites = jest
      .spyOn(chromeStorage, 'setItems')
      .mockImplementation(async (items) => {
        persisted = { ...persisted, ...structuredClone(items) };
      });
    writes = jest
      .spyOn(chromeStorage, 'setItem')
      .mockImplementation(async (key, value) => {
        persisted[key] = structuredClone(value);
      });
    // Keep the store's persistence cache aligned with each fixture's disk state.
    await persistMainStateStrict();
    writes.mockClear();
    (chrome as any).alarms = { create: jest.fn(), clear: jest.fn() };
    wallet = Object.create(MainController.prototype);
    wallet.autoLockAlarmName = 'test-auto-lock';
    wallet.isUnlocked = jest.fn().mockReturnValue(true);
    wallet.activeRapidPolls = new Map();
    wallet.walletSessionGeneration = 0;
    wallet.walletStateGeneration = 0;
    wallet.networkRequestGeneration = 0;
    wallet.fiatQuoteGeneration = 0;
    wallet.advancedSettingsMutex = new AsyncMutex();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    walletPersistenceGate.blocked = false;
  });

  it('persists the normal refresh then auto-lock Save sequence before returning', async () => {
    await wallet.setAdvancedSettings('refresh', true);
    expect(persisted.state.vaultGlobal.advancedSettings.refresh).toBe(true);
    await wallet.setAdvancedSettings('autolock', 10);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(persisted.state.vaultGlobal.advancedSettings).toMatchObject({
      refresh: true,
      autolock: 10,
    });
  });

  it.each([0, 10])(
    'keeps auto-lock=%s completion pending until the storage write succeeds',
    async (minutes) => {
      const storage = deferred();
      writes.mockImplementation(async (key, state) => {
        await storage.promise;
        persisted[key] = structuredClone(state);
      });
      let completed = false;
      const setting = wallet
        .setAdvancedSettings('autolock', minutes)
        .then(() => {
          completed = true;
        });
      await flush();
      expect(writes).toHaveBeenCalledTimes(1);
      expect(completed).toBe(false);
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(5);
      expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(5);
      storage.resolve();
      await setting;
      expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(
        minutes
      );
      if (minutes === 0) {
        expect(chrome.alarms.create).not.toHaveBeenCalled();
      } else {
        expect(chrome.alarms.create).toHaveBeenCalledWith('test-auto-lock', {
          delayInMinutes: minutes,
        });
      }
    }
  );

  it('rejects a storage failure instead of acknowledging an unsaved setting', async () => {
    writes.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(wallet.setAdvancedSettings('autolock', 10)).rejects.toThrow(
      'Storage unavailable'
    );
    expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(5);
    expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(5);
    await expect(
      wallet.setAdvancedSettings('autolock', 10)
    ).resolves.toBeUndefined();
    expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(10);
  });

  it.each([10, 20])(
    'orders an overlapping auto-lock=%s change after a failed save',
    async (laterValue) => {
      const firstWrite = deferred();
      writes.mockImplementationOnce(() => firstWrite.promise);
      const first = wallet.setAdvancedSettings('autolock', 10);
      const failed = expect(first).rejects.toThrow('First save failed');
      await flush();
      const second = wallet.setAdvancedSettings('autolock', laterValue);
      await flush();
      expect(writes).toHaveBeenCalledTimes(1);
      firstWrite.reject(new Error('First save failed'));
      await failed;
      await second;
      expect(writes).toHaveBeenCalledTimes(2);
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(
        laterValue
      );
      expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(
        laterValue
      );
    }
  );

  it.each([0, 5])(
    'keeps the previous auto-lock=%s alarm while a slow save fails',
    async (previousValue) => {
      store.dispatch(
        setAdvancedSettings({
          advancedProperty: 'autolock',
          value: previousValue,
        })
      );
      await persistMainStateStrict();
      writes.mockClear();
      const storage = deferred();
      writes.mockImplementationOnce(() => storage.promise);
      const setting = wallet.setAdvancedSettings('autolock', 10);
      const failed = expect(setting).rejects.toThrow('Storage unavailable');
      await jest.advanceTimersByTimeAsync(600);
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(
        previousValue
      );
      const previousCreates = (chrome.alarms.create as jest.Mock).mock.calls
        .length;
      const previousClears = (chrome.alarms.clear as jest.Mock).mock.calls
        .length;
      storage.reject(new Error('Storage unavailable'));
      await failed;
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(
        previousValue
      );
      expect(chrome.alarms.clear).toHaveBeenCalledTimes(previousClears);
      if (previousValue === 0) {
        expect(chrome.alarms.create).toHaveBeenCalledTimes(previousCreates);
      } else {
        expect(chrome.alarms.create).toHaveBeenLastCalledWith(
          'test-auto-lock',
          {
            delayInMinutes: previousValue,
          }
        );
      }
    }
  );

  it('keeps preferences global when account or network sessions change during a save', async () => {
    const storage = deferred();
    writes.mockImplementationOnce(async (key, state) => {
      await storage.promise;
      persisted[key] = structuredClone(state);
    });
    const setting = wallet.setAdvancedSettings('autolock', 10);
    await flush();
    wallet.walletSessionGeneration += 1;
    storage.resolve();
    await expect(setting).resolves.toBeUndefined();
    expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(10);
  });

  it('does not publish or admit an old queued setting after wallet reset', async () => {
    const storage = deferred();
    writes.mockImplementationOnce(() => storage.promise);
    const first = wallet.setAdvancedSettings('autolock', 10);
    const failed = expect(first).rejects.toThrow('Storage unavailable');
    await flush();
    const second = wallet.setAdvancedSettings('autolock', 20);
    const superseded = expect(second).rejects.toThrow('Wallet state changed');
    wallet.walletStateGeneration += 1;
    store.dispatch(
      setAdvancedSettings({ advancedProperty: 'autolock', value: 0 })
    );
    storage.reject(new Error('Storage unavailable'));
    await failed;
    await superseded;
    expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(0);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('does not publish or retain a setting when reset overtakes its successful storage write', async () => {
    const storage = deferred();
    writes.mockImplementationOnce(async (key, state) => {
      await storage.promise;
      persisted[key] = structuredClone(state);
    });
    wallet.keyrings = new Map();
    wallet.cancellablePromises = {};
    wallet.stopAllRapidPolling = jest.fn();
    wallet.cleanupPersistentProviders = jest.fn();
    wallet.cancelActiveBalanceUpdate = jest.fn();
    jest.spyOn(chromeStorage, 'removeItem').mockImplementation(async (key) => {
      delete persisted[key];
    });
    (chrome.storage.local.get as jest.Mock).mockImplementation((_keys, done) =>
      done(persisted)
    );
    const dispatch = jest.spyOn(store, 'dispatch');
    const setting = wallet.setAdvancedSettings('autolock', 10);
    const rejected = expect(setting).rejects.toThrow('Wallet state changed');
    await flush();
    const resetting = wallet.resetWalletState();
    storage.resolve();
    await rejected;
    await resetting;
    expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(0);
    expect(persisted).toEqual({});
    expect(dispatch).not.toHaveBeenCalledWith(
      setAdvancedSettings({ advancedProperty: 'autolock', value: 10 })
    );
  });

  it('preserves an ordinary pending wallet save when restarting the auto-lock alarm', async () => {
    await wallet.saveCurrentState('pending-wallet-save', false);
    await wallet.startAutoLockTimer();
    expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
    expect(ordinaryWrites).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100);
    expect(ordinaryWrites).toHaveBeenCalledTimes(1);
  });

  it('still cancels an ordinary pending save when the wallet locks', async () => {
    wallet.lockAllKeyrings = jest.fn();
    wallet.stopAllRapidPolling = jest.fn();
    jest.spyOn(vaultCache, 'emergencySave').mockResolvedValue(undefined);
    await wallet.saveCurrentState('pending-wallet-save', false);
    wallet.lock();
    await jest.advanceTimersByTimeAsync(100);
    expect(wallet.walletSessionGeneration).toBe(1);
    expect(writes).not.toHaveBeenCalled();
    expect(ordinaryWrites).not.toHaveBeenCalled();
  });

  it('still cancels an ordinary pending save before clearing a reset wallet', async () => {
    wallet.keyrings = new Map();
    wallet.cancellablePromises = {};
    wallet.stopAllRapidPolling = jest.fn();
    wallet.cleanupPersistentProviders = jest.fn();
    wallet.cancelActiveBalanceUpdate = jest.fn();
    jest.spyOn(chromeStorage, 'removeItem').mockImplementation(async (key) => {
      delete persisted[key];
    });
    (chrome.storage.local.get as jest.Mock).mockImplementation((_keys, done) =>
      done(persisted)
    );
    await wallet.saveCurrentState('pending-wallet-save', false);
    await wallet.resetWalletState();
    await jest.advanceTimersByTimeAsync(100);
    expect(wallet.walletStateGeneration).toBe(1);
    expect(wallet.walletSessionGeneration).toBe(1);
    expect(persisted).toEqual({});
    expect(writes).not.toHaveBeenCalled();
    expect(ordinaryWrites).not.toHaveBeenCalled();
  });
});
