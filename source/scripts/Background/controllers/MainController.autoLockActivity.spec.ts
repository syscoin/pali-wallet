let mockWallet: any;
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (methods: string[]) => {
    if (methods.join('.') !== 'wallet.resetAutoLockTimer')
      throw new Error('Only the normal route-activity command is expected');
    return Promise.resolve(mockWallet.resetAutoLockTimer());
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({
    wallet: mockWallet,
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  }),
  notificationManager: { cleanup: jest.fn() },
}));
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
jest.mock('scripts/Background/controllers/message-handler', () => ({
  onMessage: jest.fn(),
}));
jest.mock('scripts/Background/handlers/handlePaliUpdates', () => ({
  checkForUpdates: jest.fn(),
}));
jest.mock('scripts/Background/utils/startPolling', () => ({
  startPolling: jest.fn(),
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

import http from 'http';
import https from 'https';

import { resetControllerAutoLockForRoute } from 'hooks/controllerStatus';
import MainController from 'scripts/Background/controllers/MainController';
import {
  handleListeners,
  resetListenersFlag,
} from 'scripts/Background/handlers/handleListeners';
import { walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setAdvancedSettings } from 'state/vaultGlobal';
import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

const MINUTE = 60_000;
let unlocked: boolean;
let locked: jest.SpyInstance;
let alarmListener: (alarm: any) => void;
let alarms: Map<string, ReturnType<typeof setTimeout>>;
let routeId = 0;
let disk: Record<string, unknown>;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  const deny = () => {
    throw new Error('Auto-lock fixture must remain offline');
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  walletPersistenceGate.blocked = false;
  store.dispatch(setActiveSlip44(57));
  store.dispatch(
    setAdvancedSettings({ advancedProperty: 'autolock', value: 0 })
  );
  disk = {};
  jest.spyOn(chromeStorage, 'setItems').mockImplementation(async (items) => {
    Object.assign(disk, structuredClone(items));
  });
  jest
    .spyOn(chromeStorage, 'setItem')
    .mockImplementation(async (key, value) => {
      disk[key] = structuredClone(value);
    });
  await persistMainStateStrict();
  jest.spyOn(vaultCache, 'emergencySave').mockResolvedValue(undefined);
  unlocked = true;
  alarms = new Map();
  (chrome.runtime as any).onConnect = { addListener: jest.fn() };
  (chrome as any).alarms = {
    onAlarm: {
      addListener: jest.fn((listener) => {
        alarmListener = listener;
      }),
      removeListener: jest.fn(),
    },
    create: jest.fn((name, options) => {
      const previous = alarms.get(name);
      if (previous !== undefined) clearTimeout(previous);
      alarms.set(
        name,
        setTimeout(() => {
          alarms.delete(name);
          alarmListener({ name, scheduledTime: Date.now() });
        }, options.delayInMinutes * MINUTE)
      );
    }),
    clear: jest.fn((name) => {
      const timer = alarms.get(name);
      if (timer !== undefined) clearTimeout(timer);
      return Promise.resolve(alarms.delete(name));
    }),
  };
  mockWallet = Object.create(MainController.prototype);
  Object.assign(mockWallet, {
    autoLockAlarmName: 'pali_auto_lock_timer',
    isUnlocked: () => unlocked,
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    fiatQuoteGeneration: 0,
    advancedSettingsMutex: new AsyncMutex(),
    activeRapidPolls: new Map(),
    lockAllKeyrings: () => {
      unlocked = false;
    },
    stopAllRapidPolling: jest.fn(),
    performSave: jest.fn().mockResolvedValue(undefined),
  });
  locked = jest.spyOn(mockWallet, 'lock');
  resetListenersFlag();
  handleListeners({ wallet: mockWallet } as any);
  await mockWallet.setAdvancedSettings('autolock', 5);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  walletPersistenceGate.blocked = false;
});

const routeActivity = () =>
  resetControllerAutoLockForRoute(`/settings/public-${routeId++}`);

it('healthy idle wallet locks at its configured five-minute alarm', async () => {
  await jest.advanceTimersByTimeAsync(5 * MINUTE - 1);
  expect(locked).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(locked).toHaveBeenCalledTimes(1);
  expect(unlocked).toBe(false);
});

it('healthy earlier route activity postpones the original alarm', async () => {
  await jest.advanceTimersByTimeAsync(4 * MINUTE);
  routeActivity();
  await jest.advanceTimersByTimeAsync(500);
  await jest.advanceTimersByTimeAsync(MINUTE);
  expect(locked).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(4 * MINUTE);
  expect(locked).toHaveBeenCalledTimes(1);
});

it('route activity immediately before the old deadline must postpone locking', async () => {
  await jest.advanceTimersByTimeAsync(5 * MINUTE - 100);
  routeActivity();
  await jest.advanceTimersByTimeAsync(100);
  expect(locked).not.toHaveBeenCalled();
  expect(unlocked).toBe(true);
  await jest.advanceTimersByTimeAsync(5 * MINUTE - 101);
  expect(locked).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(locked).toHaveBeenCalledTimes(1);
});

it('healthy disabling auto-lock cancels its alarm and queued activity reset', async () => {
  routeActivity();
  await mockWallet.setAdvancedSettings('autolock', 0);
  expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(0);
  await jest.advanceTimersByTimeAsync(6 * MINUTE);
  expect(locked).not.toHaveBeenCalled();
});

it('healthy non-user background save does not postpone auto-lock', async () => {
  await jest.advanceTimersByTimeAsync(4 * MINUTE);
  await mockWallet.saveWalletState('synthetic-background-save', false, true);
  await jest.advanceTimersByTimeAsync(MINUTE);
  expect(locked).toHaveBeenCalledTimes(1);
});

it('healthy explicit user save postpones auto-lock', async () => {
  await jest.advanceTimersByTimeAsync(4 * MINUTE);
  await mockWallet.saveCurrentState('synthetic-user-save', true);
  await jest.advanceTimersByTimeAsync(MINUTE);
  expect(locked).not.toHaveBeenCalled();
});

it('replaces the alarm on activity without clearing it first', () => {
  const creates = jest.mocked(chrome.alarms.create).mock.calls.length;
  const clears = jest.mocked(chrome.alarms.clear).mock.calls.length;
  routeActivity();
  expect(chrome.alarms.create).toHaveBeenCalledTimes(creates + 1);
  expect(chrome.alarms.clear).toHaveBeenCalledTimes(clears);
  expect(alarms.size).toBe(1);
});

it('does not arm an alarm for activity while already locked', async () => {
  await mockWallet.stopAutoLockTimer();
  unlocked = false;
  const creates = jest.mocked(chrome.alarms.create).mock.calls.length;
  routeActivity();
  await jest.advanceTimersByTimeAsync(1000);
  expect(chrome.alarms.create).toHaveBeenCalledTimes(creates);
  expect(alarms.size).toBe(0);
});

it('manual locking cannot leave an activity reset that re-arms later', async () => {
  routeActivity();
  mockWallet.lock();
  await jest.advanceTimersByTimeAsync(6 * MINUTE);
  expect(locked).toHaveBeenCalledTimes(1);
  expect(unlocked).toBe(false);
  expect(alarms.size).toBe(0);
});

it('wallet reset clears its alarm and cannot re-arm from preceding activity', async () => {
  routeActivity();
  mockWallet.keyrings = new Map();
  mockWallet.cancellablePromises = {};
  mockWallet.cleanupPersistentProviders = jest.fn();
  mockWallet.cancelActiveBalanceUpdate = jest.fn();
  jest.spyOn(chromeStorage, 'removeItem').mockImplementation(async (key) => {
    for (const item of Array.isArray(key) ? key : [key]) delete disk[item];
  });
  jest
    .mocked(chrome.storage.local.get)
    .mockImplementation((_keys, callback: any) => callback(disk));
  await mockWallet.resetWalletState();
  await jest.advanceTimersByTimeAsync(6 * MINUTE);
  expect(alarms.size).toBe(0);
  expect(locked).not.toHaveBeenCalled();
});

it('a pending alarm-create completion cannot re-arm after a manual lock', async () => {
  const create = jest.mocked(chrome.alarms.create).getMockImplementation()!;
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.mocked(chrome.alarms.create).mockImplementationOnce((...args: any[]) => {
    create(args[0], args[1], args[2]);
    return completion;
  });
  routeActivity();
  expect(alarms.size).toBe(1);
  mockWallet.lock();
  release();
  await jest.advanceTimersByTimeAsync(6 * MINUTE);
  expect(locked).toHaveBeenCalledTimes(1);
  expect(alarms.size).toBe(0);
});

it('a failed replacement does not clear the already-armed alarm', async () => {
  jest.mocked(chrome.alarms.create).mockImplementationOnce(() => {
    throw new Error('Synthetic alarm service failure');
  });
  routeActivity();
  expect(alarms.size).toBe(1);
  await jest.advanceTimersByTimeAsync(5 * MINUTE);
  expect(locked).toHaveBeenCalledTimes(1);
});
