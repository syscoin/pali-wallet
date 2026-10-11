import { webcrypto } from 'crypto';
import { HDNodeWallet } from 'ethers';

import { getController } from '..';
import { walletPersistenceGate } from 'state/paliStorage';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import { forgetWallet, restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setHasEncryptedVault } from 'state/vaultGlobal';
import { AsyncMutex, walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';
import {
  prepareWalletRecoveryAccess,
  reconcileWalletRecoveryJournal,
} from './walletRecovery';

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('utils/slhDsa/offscreenClient', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn(async () => undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
}));

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const NEW_PASSWORD = 'StrongPassword12!';
const OLD_PASSWORD = 'SyntheticOldPassword12!';
const NOW = 1800000000000;
const RATE_LIMIT = 'pali_rate_limit_state';
const JOURNAL = 'pali-wallet-recovery-journal:v1';
const CLEARED_RATE_LIMIT = { failedAttempts: 0, lastFailedTime: 0 };
const clone = (value: any) => structuredClone(value);
const originalChrome = global.chrome;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
let records: Record<string, any>;
let failedReadKey: string | undefined;
let failedSetKey: string | undefined;
let failedRemoveKey: string | undefined;
let failAfterSet: boolean;
let failInitialization: boolean;
let unlocked: boolean;
let acceptedPassword: string;
let keyring: any;
let wallet: any;
let delayedRateRead:
  | { entered: () => void; fail?: boolean; release?: () => void }
  | undefined;

function installStorage() {
  global.chrome = {
    runtime: {},
    alarms: { clear: jest.fn() },
    storage: {
      local: {
        get: (keys: any, callback: any) => {
          const list =
            keys === null
              ? Object.keys(records)
              : typeof keys === 'string'
              ? [keys]
              : keys;
          if (list.length === 1 && list[0] === failedReadKey) {
            failedReadKey = undefined;
            (global.chrome.runtime as any).lastError = {
              message: 'controlled restored vault read failure',
            };
            callback({});
            delete (global.chrome.runtime as any).lastError;
            return;
          }
          const response = Object.fromEntries(
            list
              .filter((key: string) => key in records)
              .map((key: string) => [key, clone(records[key])])
          );
          if (list.length === 1 && list[0] === RATE_LIMIT && delayedRateRead) {
            const fail = delayedRateRead.fail;
            delayedRateRead.release = () => {
              if (fail) {
                (global.chrome.runtime as any).lastError = {
                  message: 'controlled old throttle read failure',
                };
              }
              callback(response);
              delete (global.chrome.runtime as any).lastError;
            };
            delayedRateRead.entered();
          } else callback(response);
        },
        set: (items: any, callback: any) => {
          if (failedSetKey && failedSetKey in items) {
            failedSetKey = undefined;
            if (failAfterSet) Object.assign(records, clone(items));
            (global.chrome.runtime as any).lastError = {
              message: 'controlled recovery cleanup write failure',
            };
            callback();
            delete (global.chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, clone(items));
          callback();
        },
        remove: (keys: any, callback: any) => {
          const list = typeof keys === 'string' ? [keys] : keys;
          if (list.includes(failedRemoveKey)) {
            failedRemoveKey = undefined;
            (global.chrome.runtime as any).lastError = {
              message: 'controlled journal cleanup failure',
            };
            callback();
            delete (global.chrome.runtime as any).lastError;
            return;
          }
          for (const key of list) delete records[key];
          callback();
        },
      },
    },
  } as any;
}

function makeVault(imported = false) {
  store.dispatch(forgetWallet());
  const vault = clone(store.getState().vault);
  const account = HDNodeWallet.fromPhrase(PHRASE);
  vault.activeNetwork = {
    kind: 'ethereum',
    chainId: 1,
    slip44: 60,
    currency: 'eth',
    label: 'Synthetic ETH',
    url: 'https://example.invalid',
  };
  vault.activeChain = 'ethereum';
  vault.isBitcoinBased = false;
  vault.accounts.HDAccount[0] = {
    ...vault.accounts.HDAccount[0],
    address: account.address,
    xpub: account.signingKey.publicKey,
    xprv: imported
      ? 'synthetic-old-account-ciphertext'
      : 'synthetic-new-account-ciphertext',
    slip44: 60,
    balances: { ethereum: -1, syscoin: -1 },
  };
  if (imported) {
    vault.accounts.Imported[7] = {
      ...vault.accounts.HDAccount[0],
      id: 7,
      isImported: true,
      xprv: 'synthetic-imported-ciphertext',
    };
  }
  return vault;
}

const resetOwned = (key: string) =>
  key === 'state' ||
  key.startsWith('state-') ||
  key === 'sysweb3-vault' ||
  key.startsWith('sysweb3-vault-');

function makeWallet() {
  // Avoid constructing RPC/hardware clients. Recovery, rate-limit methods,
  // session admission, lock, and unlock all execute from the real prototype.
  const controller: any = Object.create(MainController.prototype);
  Object.assign(controller, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    networkRequestGeneration: 0,
    isCreatingWallet: false,
    isResettingWallet: false,
    recoveryJournalPending: false,
    authenticationMutex: new AsyncMutex(),
    failedUnlockAttempts: 0,
    lastFailedUnlockTime: 0,
    rateLimitInitialized: false,
    MAX_FAILED_ATTEMPTS: 10,
    LOCKOUT_DURATION: 5 * 60 * 1000,
    RATE_LIMIT_STORAGE_KEY: RATE_LIMIT,
    keyrings: new Map([[60, keyring]]),
    activeRapidPolls: new Map(),
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    nativeBalanceRevision: 0,
    receiptBalanceRefresh: { cancel: jest.fn() },
    getActiveKeyring: () => keyring,
    resetWalletState: async () => {
      controller.walletSessionGeneration += 1;
      controller.walletStateGeneration += 1;
      unlocked = false;
      vaultCache.clearCache();
      await walletPersistenceMutex.runExclusive(async () => {
        for (const key of Object.keys(records).filter(resetOwned)) {
          await chromeStorage.removeItem(key);
        }
        store.dispatch(forgetWallet());
      });
    },
    // Only KDF/account initialization is a stand-in: it writes synthetic
    // ciphertext through the actual adapter and follows reset generations.
    createWalletExclusive: async (password: string) => {
      await controller.resetWalletState();
      if (failInitialization) throw new Error('controlled initializer failure');
      const vault = makeVault();
      store.dispatch(restoreVaultSnapshot(vault));
      store.dispatch(setActiveSlip44(60));
      store.dispatch(setHasEncryptedVault(true));
      const state = store.getState();
      await chromeStorage.setItems({
        'sysweb3-vault': 'synthetic-new-seed-ciphertext',
        'sysweb3-vault-keys': { salt: 'synthetic-new-salt' },
        state: {
          dapp: state.dapp,
          price: state.price,
          vaultGlobal: state.vaultGlobal,
        },
        'state-vault-60': vault,
      });
      acceptedPassword = password;
      unlocked = true;
    },
  });
  return controller;
}

async function establishLockout() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await expect(wallet.unlock('incorrect-password')).resolves.toEqual({
      canLogin: false,
    });
  }
  expect(records[RATE_LIMIT]).toEqual({
    failedAttempts: 10,
    lastFailedTime: NOW,
  });
  expect(await wallet.getRemainingLockoutTime()).toBe(300);
}

async function recover() {
  const ticket = await wallet.beginWalletRecovery();
  await wallet.recoverWalletFromSeed(NEW_PASSWORD, PHRASE, ticket);
}

async function finishColdRecovery() {
  vaultCache.clearCache();
  store.dispatch(forgetWallet());
  walletPersistenceGate.blocked = false;
  await reconcileWalletRecoveryJournal({
    getState: store.getState,
    persistenceMutex: walletPersistenceMutex,
    readPresence: async () => true,
    rehydrate: (state) =>
      rehydrateStore(store, state, state.vaultGlobal?.activeSlip44, false),
    storage: chromeStorage,
  });
  await rehydrateStore(store);
  unlocked = false;
  wallet = makeWallet();
}

describe('seed recovery unlock throttle', () => {
  beforeEach(() => {
    walletPersistenceGate.blocked = false;
    records = {};
    failedReadKey = undefined;
    failedSetKey = undefined;
    failedRemoveKey = undefined;
    failAfterSet = false;
    failInitialization = false;
    delayedRateRead = undefined;
    unlocked = false;
    acceptedPassword = OLD_PASSWORD;
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    installStorage();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(getController).mockReturnValue({
      dapp: { handleStateChange: jest.fn(async () => undefined) },
    } as any);
    const vault = makeVault(true);
    store.dispatch(restoreVaultSnapshot(vault));
    store.dispatch(setActiveSlip44(60));
    store.dispatch(setHasEncryptedVault(true));
    const state = store.getState();
    records = {
      'sysweb3-vault': 'synthetic-old-seed-ciphertext',
      'sysweb3-vault-keys': { salt: 'synthetic-old-salt' },
      state: {
        dapp: clone(state.dapp),
        price: clone(state.price),
        vaultGlobal: clone(state.vaultGlobal),
      },
      'state-vault-60': clone(vault),
      [RATE_LIMIT]: clone(CLEARED_RATE_LIMIT),
    };
    keyring = {
      isUnlocked: () => unlocked,
      isSeedValid: (phrase: string) => phrase === PHRASE,
      lockWallet: jest.fn(async () => {
        unlocked = false;
      }),
      unlock: jest.fn(async (password: string) => {
        const canLogin = password === acceptedPassword;
        unlocked = canLogin;
        return { canLogin };
      }),
    };
    wallet = makeWallet();
    vaultCache.clearCache();
  });

  afterEach(async () => {
    delayedRateRead?.release?.();
    delayedRateRead = undefined;
    await walletPersistenceMutex.runExclusive(() => undefined);
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    global.chrome = originalChrome;
    if (originalCrypto)
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    jest.restoreAllMocks();
  });

  it.each([true, false])(
    'accepts the new password after committed recovery and lock (old throttle loaded: %s)',
    async (loaded) => {
      await establishLockout();
      if (!loaded) wallet = makeWallet();
      await recover();
      wallet.lock();
      await expect(wallet.unlock(NEW_PASSWORD)).resolves.toEqual({
        canLogin: true,
      });
      expect(records[RATE_LIMIT]).toEqual(CLEARED_RATE_LIMIT);
      expect(wallet.failedUnlockAttempts).toBe(0);
      expect(wallet.lastFailedUnlockTime).toBe(0);
      expect(records[JOURNAL]).toBeUndefined();
    }
  );

  it('keeps ordinary wrong-password lockout durable across controllers', async () => {
    await establishLockout();
    keyring.unlock.mockClear();
    await expect(wallet.unlock(OLD_PASSWORD)).rejects.toThrow(
      'Too many failed attempts'
    );
    wallet = makeWallet();
    await expect(wallet.unlock(OLD_PASSWORD)).rejects.toThrow(
      'Too many failed attempts'
    );
    expect(keyring.unlock).not.toHaveBeenCalled();
    expect(records[RATE_LIMIT]).toEqual({
      failedAttempts: 10,
      lastFailedTime: NOW,
    });
  });

  it('retains the old wallet throttle after failed recovery rolls back', async () => {
    await establishLockout();
    const before = clone(records);
    failInitialization = true;
    await expect(recover()).rejects.toThrow(
      'Your previous wallet was restored'
    );
    expect(records).toEqual(before);
    expect(await wallet.getRemainingLockoutTime()).toBe(300);
    keyring.unlock.mockClear();
    await expect(wallet.unlock(OLD_PASSWORD)).rejects.toThrow(
      'Too many failed attempts'
    );
    expect(keyring.unlock).not.toHaveBeenCalled();
  });

  it('retains the throttle when the recovery phrase fails admission', async () => {
    await establishLockout();
    const before = clone(records);
    const ticket = await wallet.beginWalletRecovery();
    await expect(
      wallet.recoverWalletFromSeed(NEW_PASSWORD, 'invalid phrase', ticket)
    ).rejects.toThrow('Invalid recovery phrase');
    expect(records).toEqual(before);
    expect(await wallet.getRemainingLockoutTime()).toBe(300);
  });

  it.each([false, true])(
    'keeps committed cleanup pending when throttle reset fails (write applied: %s), then retries on cold startup',
    async (writeApplied) => {
      await establishLockout();
      failedSetKey = RATE_LIMIT;
      failAfterSet = writeApplied;
      await expect(recover()).rejects.toThrow('finish wallet recovery cleanup');
      expect(records['sysweb3-vault']).toBe('synthetic-new-seed-ciphertext');
      expect(records[JOURNAL].committedFingerprint).toBeDefined();
      expect(wallet.recoveryJournalPending).toBe(true);
      expect(wallet.getWalletSetupStatus()).toBe('recovery-required');
      expect(wallet.isUnlocked()).toBe(false);
      expect(wallet.failedUnlockAttempts).toBe(10);
      expect(records[RATE_LIMIT]).toEqual(
        writeApplied
          ? CLEARED_RATE_LIMIT
          : { failedAttempts: 10, lastFailedTime: NOW }
      );
      await finishColdRecovery();
      await expect(wallet.unlock(NEW_PASSWORD)).resolves.toEqual({
        canLogin: true,
      });
      expect(records[RATE_LIMIT]).toEqual(CLEARED_RATE_LIMIT);
      expect(records[JOURNAL]).toBeUndefined();
    }
  );

  it('retries warm committed journal cleanup without inheriting the old throttle', async () => {
    await establishLockout();
    failedRemoveKey = JOURNAL;
    await expect(recover()).rejects.toThrow('finish wallet recovery cleanup');
    expect(records[JOURNAL].committedFingerprint).toBeDefined();
    expect(records[RATE_LIMIT]).toEqual(CLEARED_RATE_LIMIT);
    expect(wallet.failedUnlockAttempts).toBe(0);
    await prepareWalletRecoveryAccess(wallet, wallet.walletRecoveryContext());
    await expect(wallet.unlock(NEW_PASSWORD)).resolves.toEqual({
      canLogin: true,
    });
    expect(records[JOURNAL]).toBeUndefined();
    expect(wallet.recoveryJournalPending).toBe(false);
  });

  it('retries a committed throttle-write failure before checking warm unlock lockout', async () => {
    await establishLockout();
    failedSetKey = RATE_LIMIT;
    await expect(recover()).rejects.toThrow('finish wallet recovery cleanup');
    expect(wallet.failedUnlockAttempts).toBe(10);
    expect(records[JOURNAL].committedFingerprint).toBeDefined();
    await expect(wallet.unlock(NEW_PASSWORD)).resolves.toEqual({
      canLogin: true,
    });
    expect(wallet.failedUnlockAttempts).toBe(0);
    expect(records[RATE_LIMIT]).toEqual(CLEARED_RATE_LIMIT);
    expect(records[JOURNAL]).toBeUndefined();
  });

  it('does not clear throttle or admit unlock through an uncommitted journal', async () => {
    await establishLockout();
    failInitialization = true;
    failedReadKey = 'state-vault-60';
    await expect(recover()).rejects.toThrow('Failed to rehydrate state');
    expect(records[JOURNAL].committedFingerprint).toBeUndefined();
    keyring.unlock.mockClear();
    await expect(wallet.unlock(OLD_PASSWORD)).rejects.toThrow(
      'finish wallet recovery'
    );
    expect(keyring.unlock).not.toHaveBeenCalled();
    expect(wallet.failedUnlockAttempts).toBe(10);
    expect(records[RATE_LIMIT]).toEqual({
      failedAttempts: 10,
      lastFailedTime: NOW,
    });
    await finishColdRecovery();
    await expect(wallet.unlock(OLD_PASSWORD)).rejects.toThrow(
      'Too many failed attempts'
    );
    expect(records[RATE_LIMIT]).toEqual({
      failedAttempts: 10,
      lastFailedTime: NOW,
    });
  });

  it.each([false, true])(
    'ignores an old throttle read completing after recovery reset (read fails: %s)',
    async (readFails) => {
      await establishLockout();
      wallet = makeWallet();
      const entered = new Promise<void>((resolve) => {
        delayedRateRead = { entered: resolve, fail: readFails };
      });
      const loading = wallet.getRemainingLockoutTime();
      await entered;
      await recover();
      const release = delayedRateRead?.release;
      delayedRateRead = undefined;
      release!();
      expect(await loading).toBe(0);
      expect(wallet.failedUnlockAttempts).toBe(0);
      wallet.lock();
      await expect(wallet.unlock(NEW_PASSWORD)).resolves.toEqual({
        canLogin: true,
      });
      expect(records[RATE_LIMIT]).toEqual(CLEARED_RATE_LIMIT);
    }
  );
});
