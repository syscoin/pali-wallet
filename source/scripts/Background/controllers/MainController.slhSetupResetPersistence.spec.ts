jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));

import { sysweb3Di } from '@sidhujag/sysweb3-core';
import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import http from 'http';
import https from 'https';

import { getController } from '..';
import { walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { createAccount, restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setHasEncryptedVault } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { AsyncMutex, walletPersistenceMutex } from 'utils/asyncMutex';
import {
  clearRuntimeSLHDSAStates,
  persistSLHDSASmartAccountSetupProgress,
  saveSLHDSAPreparedSmartAccountSigner,
  SLH_DSA_PARAMETER_SET,
  startSLHDSASmartAccountValidatorSetup,
} from 'utils/slhDsa';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'SyntheticSetupReset12!';
const SETUP_KEY = 'pali-slh-dsa-smart-account-setup:0';
const PREPARED_KEY = 'pali-slh-dsa-prepared-smart-account-signer:v1:0';
const publicConfig = {
  keyId: 'synthetic-public-key-id',
  parameterSet: SLH_DSA_PARAMETER_SET,
  pkRoot: `0x${'11'.repeat(32)}`,
  pkSeed: `0x${'22'.repeat(32)}`,
  signatureLimit: 1000,
};
const initialVault = store.getState().vault;
const originalChrome = global.chrome;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator'
);
let manager: KeyringManager;
let wallet: any;
let records: Record<string, any>;
let refuseRemoval: string | undefined;
const remainingWalletKeys = () =>
  Object.keys(records).filter(
    (key) =>
      key === 'state' ||
      key.startsWith('state-') ||
      key.startsWith('sysweb3-vault') ||
      key.startsWith('pali-slh-dsa-')
  );

const holdNativeWrite = (matches: (items: Record<string, any>) => boolean) => {
  const nativeSet = chrome.storage.local.set;
  let release!: () => void;
  let entered!: () => void;
  let held = false;
  const started = new Promise<void>((resolve) => (entered = resolve));
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      if (!held && matches(items)) {
        held = true;
        release = () => {
          void nativeSet(items, callback);
        };
        entered();
        return Promise.resolve();
      }
      return nativeSet(items, callback);
    });
  return { started, release: () => release() };
};

const forgetBehindHeldWrite = async (release: () => void) => {
  const run = walletPersistenceMutex.runExclusive.bind(walletPersistenceMutex);
  let requested!: () => void;
  let entered = false;
  let observed = false;
  const queued = new Promise<void>((resolve) => (requested = resolve));
  // Observe, but do not replace, the real Forget backup mutex operation. Two
  // microtasks suffice for a free mutex to enter its callback after request;
  // a held setup write must instead keep that callback queued.
  const observer = jest
    .spyOn(walletPersistenceMutex, 'runExclusive')
    .mockImplementation((action) => {
      if (observed) return run(action);
      observed = true;
      requested();
      return run(() => {
        entered = true;
        return action();
      });
    });
  const forgetting = wallet.forgetWallet(PASSWORD);
  try {
    await queued;
    await Promise.resolve();
    await Promise.resolve();
    expect(entered).toBe(false);
  } finally {
    release();
    await forgetting;
    observer.mockRestore();
  }
  expect(entered).toBe(true);
  expect(remainingWalletKeys()).toEqual([]);
};

beforeEach(async () => {
  const deny = () => {
    throw new Error('SLH setup reset diagnostic must remain offline');
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  const storageLock = new AsyncMutex();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, _options: unknown, run: () => unknown) =>
          storageLock.runExclusive(run),
      },
    },
  });
  records = {};
  refuseRemoval = undefined;
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  clearRuntimeSLHDSAStates();
  global.chrome = {
    runtime: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    alarms: { clear: jest.fn() },
    storage: {
      local: {
        get: (
          keys: string[] | string | null,
          callback?: (value: any) => void
        ) => {
          const list = keys === null ? Object.keys(records) : [keys].flat();
          const value = Object.fromEntries(
            list
              .filter((key) => key in records)
              .map((key) => [key, structuredClone(records[key])])
          );
          callback?.(value);
          return Promise.resolve(value);
        },
        set: (items: Record<string, any>, callback?: () => void) => {
          Object.assign(records, structuredClone(items));
          callback?.();
          return Promise.resolve();
        },
        remove: (keys: string[] | string, callback?: () => void) => {
          const requested = [keys].flat();
          if (requested.includes(refuseRemoval)) {
            refuseRemoval = undefined;
            (chrome.runtime as any).lastError = {
              message: 'Synthetic reset removal refusal',
            };
            callback?.();
            delete (chrome.runtime as any).lastError;
            return Promise.resolve();
          }
          for (const key of requested) delete records[key];
          callback?.();
          return Promise.resolve();
        },
      },
    },
  } as any;
  sysweb3Di.getStateStorageDb().setClient(chrome.storage.local as any);
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  store.dispatch(
    restoreVaultSnapshot({
      ...initialVault,
      activeNetwork: {
        kind: INetworkType.Ethereum,
        slip44: 60,
        chainId: 1,
        url: 'https://slh-reset.synthetic.invalid',
        currency: 'eth',
        label: 'Synthetic EVM',
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts: groups(),
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  manager = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault as any);
  const account = await manager.initializeWalletSecurely(PHRASE, PASSWORD);
  store.dispatch(
    createAccount({ account, accountType: KeyringAccountType.HDAccount })
  );
  // A public stored SmartAccount fixture; the initial setup status is written
  // before its SDK secret derivation or offscreen key-generation can begin.
  store.dispatch(
    createAccount({
      account: {
        id: 0,
        address: '0x1111111111111111111111111111111111111111',
        label: 'Synthetic smart account',
        isSmartAccount: true,
        smartAccount: { descriptor: { accountIndex: 0 } },
      } as any,
      accountType: KeyringAccountType.SmartAccount,
    })
  );
  store.dispatch(setHasEncryptedVault(true));
  await persistCommittedWalletState(true);
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    fiatQuoteGeneration: 0,
    authenticationMutex: new AsyncMutex(),
    cancellablePromises: {},
    keyrings: new Map([[60, manager]]),
    checkRateLimit: jest.fn().mockResolvedValue(0),
    resetRateLimit: jest.fn().mockResolvedValue(undefined),
    clearAllTimers: jest.fn(),
    stopAllRapidPolling: jest.fn(),
    cleanupPersistentProviders: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    stopAutoLockTimer: jest.fn().mockResolvedValue(undefined),
    getActiveKeyring: () => manager,
    isUnlocked: () => manager.isUnlocked(),
  });
  jest.mocked(getController).mockReturnValue({
    dapp: {
      getAll: () => ({}),
      handleStateChange: jest.fn().mockResolvedValue(undefined),
      resetSessions: jest.fn().mockResolvedValue(undefined),
    },
  } as any);
});

afterEach(async () => {
  await manager?.destroy();
  clearRuntimeSLHDSAStates();
  sysweb3Di.getStateStorageDb().setClient();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  store.dispatch(restoreVaultSnapshot(initialVault));
  global.chrome = originalChrome;
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  if (originalNavigator)
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as any).navigator;
  jest.restoreAllMocks();
});

it('ordinary Forget removes an already stored public setup record', async () => {
  await chromeStorage.setItem(SETUP_KEY, { accountId: 0, status: 'failed' });
  await wallet.forgetWallet(PASSWORD);
  expect(remainingWalletKeys()).toEqual([]);
  expect(manager.isUnlocked()).toBe(false);
});

it('does not restore public setup status after Forget reports successful cleanup', async () => {
  const held = holdNativeWrite((items) => SETUP_KEY in items);
  const starting = wallet.startSLHDSASmartAccountValidatorSetup({
    accountId: 0,
  });
  await held.started;
  await forgetBehindHeldWrite(held.release);
  await expect(starting).resolves.toMatchObject({ status: 'running' });
  expect(remainingWalletKeys()).toEqual([]);
  await expect(
    wallet.getSLHDSASmartAccountSetupStatus({ accountId: 0 })
  ).resolves.toBeNull();
});

it('serializes public progress before Forget even while key generation remains pending', async () => {
  let stop!: (error: Error) => void;
  const secret = new Promise<never>((_resolve, reject) => (stop = reject));
  const status = await startSLHDSASmartAccountValidatorSetup({
    accountId: 0,
    accountIndex: 0,
    getSetupSecret: () => secret,
  });
  const held = holdNativeWrite((items) => Boolean(items[SETUP_KEY]?.progress));
  const progress = persistSLHDSASmartAccountSetupProgress({
    accountId: 0,
    setupJobId: status.setupJobId,
    progress: { phase: 'xmss-cache', completed: 1, total: 4, level: 1 },
  });
  try {
    await held.started;
    await forgetBehindHeldWrite(held.release);
    await expect(progress).resolves.toBe(true);
    await expect(
      persistSLHDSASmartAccountSetupProgress({
        accountId: 0,
        setupJobId: status.setupJobId,
        progress: { phase: 'xmss-cache', completed: 2, total: 4, level: 1 },
      })
    ).resolves.toBe(false);
  } finally {
    stop(new Error('Synthetic pending key generation retired'));
  }
});

it('serializes a ready public signer record before Forget cleanup', async () => {
  const held = holdNativeWrite((items) => PREPARED_KEY in items);
  const saving = saveSLHDSAPreparedSmartAccountSigner({
    accountId: 0,
    config: publicConfig,
  });
  await held.started;
  await forgetBehindHeldWrite(held.release);
  await expect(saving).resolves.toMatchObject({ config: publicConfig });
  expect(remainingWalletKeys()).toEqual([]);
});

it('releases a rejected native setup write for the same account retry', async () => {
  const nativeSet = chrome.storage.local.set;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementationOnce((items, callback) => {
      expect(items[PREPARED_KEY]).toBeDefined();
      (chrome.runtime as any).lastError = {
        message: 'Synthetic public signer write refusal',
      };
      callback?.();
      delete (chrome.runtime as any).lastError;
      return Promise.resolve();
    })
    .mockImplementation(nativeSet);
  const save = () =>
    saveSLHDSAPreparedSmartAccountSigner({
      accountId: 0,
      config: publicConfig,
    });
  await expect(save()).rejects.toMatchObject({
    message: 'Synthetic public signer write refusal',
  });
  expect(records[PREPARED_KEY]).toBeUndefined();
  await expect(save()).resolves.toMatchObject({ config: publicConfig });
  expect(records[PREPARED_KEY].config).toEqual(publicConfig);
});

it('serializes the final ready status before Forget without holding the lock across worker computation', async () => {
  // Only the isolated worker response is synthetic. MainController, installed
  // SDK derivation/encryption, the real setup pipeline and native storage run.
  (chrome.runtime as any).getContexts = jest
    .fn()
    .mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
  jest
    .mocked(chrome.runtime.sendMessage)
    .mockImplementation(async (message: any) =>
      message.type === 'PALI_SLH_DSA_PREPARE_KEYPAIR'
        ? {
            success: true,
            result: {
              pkRoot: `0x${'11'.repeat(16)}${'00'.repeat(16)}`,
              pkSeed: `0x${'22'.repeat(16)}${'00'.repeat(16)}`,
              secretKeyHex: `0x${'33'.repeat(64)}`,
            },
          }
        : undefined
    );
  const held = holdNativeWrite((items) => items[SETUP_KEY]?.status === 'ready');
  await expect(
    wallet.startSLHDSASmartAccountValidatorSetup({ accountId: 0 })
  ).resolves.toMatchObject({ status: 'running' });
  await held.started;
  await forgetBehindHeldWrite(held.release);
  expect(remainingWalletKeys()).toEqual([]);
});

it('preserves the captured public setup status when actual Forget cleanup fails and rolls back', async () => {
  const status = {
    accountId: 0,
    status: 'failed',
    error: 'Synthetic setup error',
  };
  await chromeStorage.setItem(SETUP_KEY, status);
  refuseRemoval = 'sysweb3-vault';
  await expect(wallet.forgetWallet(PASSWORD)).rejects.toMatchObject({
    message: 'Synthetic reset removal refusal',
  });
  expect(records[SETUP_KEY]).toEqual(status);
  expect(records['sysweb3-vault']).toEqual(expect.any(String));
  expect(records['sysweb3-vault-keys']).toEqual(expect.any(Object));
  expect(records['pali-wallet-recovery-journal:v1']).toBeUndefined();
  expect(walletPersistenceGate.blocked).toBe(false);
});

it('reuses a healthy ready setup without deriving another secret', async () => {
  const ready = {
    accountId: 0,
    config: publicConfig,
    startedAt: 1,
    status: 'ready',
    updatedAt: 2,
  };
  await chromeStorage.setItem(SETUP_KEY, ready);
  const getSetupSecret = jest.fn();
  await expect(
    startSLHDSASmartAccountValidatorSetup({
      accountId: 0,
      accountIndex: 0,
      getSetupSecret,
    })
  ).resolves.toEqual(ready);
  expect(getSetupSecret).not.toHaveBeenCalled();
  await wallet.forgetWallet(PASSWORD);
  expect(remainingWalletKeys()).toEqual([]);
});
