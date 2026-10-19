jest.mock('..', () => ({
  getController: jest.fn(),
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
jest.mock('utils/slhDsa', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
  clearSLHDSAPublicPrecomputeCache: jest.fn().mockResolvedValue(undefined),
  clearSLHDSAXmssTreeCache: jest.fn().mockResolvedValue(undefined),
}));

import { webcrypto } from 'crypto';

import { getController } from '..';
import { rehydrate as rehydrateDapps } from 'state/dapp';
import { walletPersistenceGate } from 'state/paliStorage';
import store, {
  loadAndActivateSlip44Vault,
  persistMainStateStrict,
} from 'state/store';
import {
  createAccount,
  initializeCleanVaultForSlip44,
  restoreVaultSnapshot,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
import { SYSCOIN_MAINNET_NETWORK } from 'utils/constants';

import DAppController from './DAppController';
import MainController from './MainController';
import { PaliEvents } from './message-handler/types';
import { reconcileWalletRecoveryJournal } from './walletRecovery';

const JOURNAL = 'pali-wallet-recovery-journal:v1';

describe('wallet reset durable cleanup', () => {
  let wallet: any;
  let records: Record<string, any>;
  let failRemoval: string | undefined;
  let removeAfterApply: boolean;
  let failRestore: boolean;
  let journalWriteFault: 'before' | 'after' | 'noop' | undefined;
  let noOpRemoval: string | undefined;
  let unlocked: boolean;
  let oldEvmVault: any;
  let originalRecords: Record<string, any>;
  const initialVault = store.getState().vault;
  const initialDapps = store.getState().dapp;
  const originalChrome = global.chrome;
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    walletPersistenceGate.blocked = false;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    vaultCache.clearCache();
    store.dispatch(restoreVaultSnapshot(initialVault));
    store.dispatch(rehydrateDapps(initialDapps));
    store.dispatch(setActiveSlip44(57));
    oldEvmVault = {
      ...initialVault,
      activeNetwork: SYSCOIN_MAINNET_NETWORK,
      accounts: {
        ...initialVault.accounts,
        [KeyringAccountType.Imported]: {
          7: {
            id: 7,
            address: '0x1111111111111111111111111111111111111111',
            label: 'Previous wallet imported account',
            xprv: 'synthetic encrypted imported key',
          },
        },
      },
    };
    records = {
      'sysweb3-vault': 'synthetic root ciphertext',
      'sysweb3-vault-keys': { salt: 'synthetic salt' },
      'state-vault-57': initialVault,
      'state-vault-60': oldEvmVault,
      'state-vault-60-passkey-profile': {
        passkeyCredentialProfile: { label: 'Previous profile' },
      },
      state: { vaultGlobal: { activeSlip44: 57 } },
      'sentry-operator-v1:synthetic:mainnet': {
        encrypted: 'synthetic operator',
      },
      'sentry-settings-v1:synthetic:mainnet': { maxFeeSatoshis: '500' },
      'sentry-collateral-v1:synthetic:mainnet': [{ txid: 'synthetic' }],
      'sentry-linked-v1:synthetic:mainnet': [{ proTxHash: 'synthetic' }],
    };
    originalRecords = structuredClone(records);
    failRemoval = undefined;
    removeAfterApply = false;
    failRestore = false;
    journalWriteFault = undefined;
    noOpRemoval = undefined;
    unlocked = true;
    global.chrome = {
      ...originalChrome,
      runtime: {
        ...originalChrome.runtime,
        sendMessage: jest.fn().mockResolvedValue(undefined),
      },
      storage: {
        ...originalChrome.storage,
        local: {
          get: jest.fn((keys, callback) => {
            const requested =
              keys === null
                ? Object.keys(records)
                : Array.isArray(keys)
                ? keys
                : [keys];
            callback(
              Object.fromEntries(
                requested
                  .filter((key) => key in records)
                  .map((key) => [key, structuredClone(records[key])])
              )
            );
          }),
          set: jest.fn((items, callback) => {
            if (JOURNAL in items && journalWriteFault) {
              const fault = journalWriteFault;
              journalWriteFault = undefined;
              if (fault === 'after')
                Object.assign(records, structuredClone(items));
              if (fault !== 'noop')
                (chrome.runtime as any).lastError = {
                  message: 'synthetic backup write failure',
                };
              callback();
              delete (chrome.runtime as any).lastError;
              return;
            }
            if (failRestore && 'sysweb3-vault' in items) {
              (chrome.runtime as any).lastError = {
                message: 'synthetic restore failure',
              };
              callback();
              delete (chrome.runtime as any).lastError;
              return;
            }
            Object.assign(records, structuredClone(items));
            callback();
          }),
          remove: jest.fn((keys, callback) => {
            const requested = Array.isArray(keys) ? keys : [keys];
            if (requested.includes(noOpRemoval)) {
              callback();
              return;
            }
            if (requested.includes(failRemoval)) {
              if (removeAfterApply) {
                requested.forEach((key) => delete records[key]);
                failRemoval = undefined;
              }
              (chrome.runtime as any).lastError = {
                message: 'synthetic storage removal failure',
              };
              callback();
              delete (chrome.runtime as any).lastError;
              return;
            }
            requested.forEach((key) => delete records[key]);
            callback();
          }),
        },
      },
    } as any;
    wallet = Object.create(MainController.prototype);
    Object.assign(wallet, {
      walletStateGeneration: 0,
      walletSessionGeneration: 0,
      networkRequestGeneration: 0,
      fiatQuoteGeneration: 0,
      authenticationMutex: new AsyncMutex(),
      cancellablePromises: {},
      keyrings: new Map(),
      checkRateLimit: jest.fn().mockResolvedValue(0),
      resetRateLimit: jest.fn().mockResolvedValue(undefined),
      clearAllTimers: jest.fn(),
      stopAllRapidPolling: jest.fn(),
      disposeAllKeyrings: jest.fn(),
      cleanupPersistentProviders: jest.fn(),
      cancelActiveBalanceUpdate: jest.fn(),
      stopAutoLockTimer: jest.fn().mockResolvedValue(undefined),
      lockAllKeyrings: jest.fn(() => {
        unlocked = false;
      }),
      getActiveKeyring: () => keyring,
      isUnlocked: () => unlocked,
      recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
    });
    const keyring = {
      isUnlocked: () => unlocked,
      getSeed: jest.fn(async (password: string) => {
        if (!unlocked) throw new Error('Unlock wallet first');
        if (password !== 'synthetic password')
          throw new Error('Invalid password');
        return 'synthetic test seed';
      }),
    };
    jest.mocked(getController).mockReturnValue({
      dapp: {
        handleStateChange: jest.fn().mockResolvedValue(undefined),
        getAll: () => store.getState().dapp.dapps,
        resetSessions: jest.fn().mockResolvedValue(undefined),
      },
    } as any);
  });

  afterEach(() => {
    global.chrome = originalChrome;
    if (originalCrypto)
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    vaultCache.clearCache();
    walletPersistenceGate.blocked = false;
    store.dispatch(restoreVaultSnapshot(initialVault));
    store.dispatch(rehydrateDapps(initialDapps));
    store.dispatch(setActiveSlip44(57));
    jest.restoreAllMocks();
  });

  it('reports a successful forget only after every wallet-owned storage record is removed', async () => {
    await expect(
      wallet.forgetWallet('synthetic password')
    ).resolves.toBeUndefined();
    expect(records).toEqual({});
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'wallet_forgotten',
    });
  });

  const prepareSentrySettings = () => {
    const current = store.getState().vault;
    store.dispatch(
      restoreVaultSnapshot({
        ...current,
        accounts: {
          ...current.accounts,
          HDAccount: {
            0: {
              ...current.accounts.HDAccount[0],
              address: 'synthetic-address',
              xpub: 'public-sentry-test-root',
            },
          },
        },
      })
    );
    records['state-vault-57'] = structuredClone(store.getState().vault);
    return () =>
      wallet.saveSentrySettings({
        password: 'synthetic password',
        serviceUrl: 'https://sysnode.info',
        maxFeeSatoshis: '2000',
      });
  };

  it('removes a completed Sentry preference during public forget', async () => {
    const settings = await prepareSentrySettings()();
    expect(settings.maxFeeSatoshis).toBe('2000');
    await wallet.forgetWallet('synthetic password');
    expect(records).toEqual({});
  });

  it.each([false, true])(
    'orders a pending Sentry preference before reset cleanup and rollback=%s',
    async (resetFails) => {
      const save = prepareSentrySettings();
      const write = jest
        .mocked(chrome.storage.local.set)
        .getMockImplementation()!;
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => (entered = resolve));
      let hold = true;
      jest
        .mocked(chrome.storage.local.set)
        .mockImplementation((items, callback) => {
          if (
            hold &&
            Object.keys(items).some((key) =>
              key.startsWith('sentry-settings-v1:')
            )
          ) {
            hold = false;
            release = () => write(items, callback);
            entered();
          } else write(items, callback);
        });
      const saving = save().catch((error: Error) => error);
      await started;
      if (resetFails) failRemoval = 'state-vault-60';
      let completed = false;
      const forgetting = wallet.forgetWallet('synthetic password').then(
        () => {
          completed = true;
          return undefined;
        },
        (error: Error) => error
      );
      // Public forget cannot pass its backup/cleanup boundary while the older
      // final write owns persistence. No controller result is replaced.
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
      expect(completed).toBe(false);
      expect(chrome.storage.local.remove).not.toHaveBeenCalled();
      release();
      const savedSnapshot = structuredClone(records);
      const result = await forgetting;
      await saving;
      if (resetFails) {
        expect(result).toMatchObject({
          message: 'synthetic storage removal failure',
        });
        expect(records).toEqual(savedSnapshot);
        expect(walletPersistenceGate.blocked).toBe(false);
      } else {
        expect(result).toBeUndefined();
        expect(records).toEqual({});
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
          type: 'wallet_forgotten',
        });
      }
    }
  );

  const seedOldPermission = (
    address = '0x1111111111111111111111111111111111111111'
  ) => {
    const host = 'https://previous-wallet.invalid';
    const oldVault = {
      ...store.getState().vault,
      accounts: {
        ...store.getState().vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            address,
            xpub: 'public-old-xpub',
            label: 'Old synthetic wallet',
          },
        },
      },
    };
    store.dispatch(restoreVaultSnapshot(oldVault as any));
    store.dispatch(
      rehydrateDapps({
        dapps: {
          [host]: {
            host,
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
            chain: 'ethereum',
            chainId: 1,
            date: 1,
          },
        },
      } as any)
    );
    records['state-vault-57'] = structuredClone(oldVault);
    records.state = {
      ...records.state,
      dapp: structuredClone(store.getState().dapp),
    };
    originalRecords = structuredClone(records);
    return { host, address };
  };

  const installLiveDapp = () => {
    const { host, address } = seedOldPermission('sys1previous');
    const dapp = DAppController(
      () => unlocked,
      () => wallet.walletStateGeneration
    );
    jest.mocked(getController).mockReturnValue({ dapp } as any);
    (chrome.runtime as any).id = 'wallet-reset-test';
    (chrome as any).tabs = {
      query: jest.fn((_query, reply) =>
        reply([{ id: 7, url: `${host}/page` }])
      ),
    };
    (chrome as any).scripting = {
      executeScript: jest.fn().mockResolvedValue([]),
    };
    dapp.setup({ url: `${host}/page` });
    dapp.setHasWindow(host, true);
    return { dapp, host, address, reset: jest.spyOn(dapp, 'resetSessions') };
  };

  it('clears live sessions only after a successful public forget', async () => {
    const { dapp, host, reset } = installLiveDapp();
    await wallet.forgetWallet('synthetic password');
    expect(records).toEqual({});
    expect(reset).toHaveBeenCalledWith([host]);
    expect(dapp.getAll()).toEqual({});
    expect(() => dapp.hasWindow(host)).toThrow();
    const notifications = jest
      .mocked(chrome.scripting.executeScript)
      .mock.calls.map(([options]) => options.args?.[0]);
    expect(notifications).toHaveLength(3);
    expect(notifications[0]).toEqual({
      id: PaliEvents.lockStateChanged,
      data: {
        method: PaliEvents.lockStateChanged,
        params: { isUnlocked: false, accounts: [], xpub: null },
      },
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'wallet_forgotten',
    });
  });

  it('keeps real live routing unchanged when the forget password is wrong', async () => {
    const { dapp, host, address, reset } = installLiveDapp();
    await expect(wallet.forgetWallet('wrong password')).rejects.toThrow(
      'Invalid password'
    );
    expect(reset).not.toHaveBeenCalled();
    expect(dapp.hasWindow(host)).toBe(true);
    expect(dapp.getAccount(host)?.address).toBe(address);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(records).toEqual(originalRecords);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(unlocked).toBe(true);
  });

  it('retains real live routing after rollback so the restored wallet can notify its next unlock', async () => {
    const { dapp, host, address, reset } = installLiveDapp();
    failRemoval = 'state-vault-60';
    await expect(
      wallet.forgetWallet('synthetic password')
    ).rejects.toMatchObject({ message: 'synthetic storage removal failure' });
    await new Promise(setImmediate);
    expect(records).toEqual(originalRecords);
    expect(reset).not.toHaveBeenCalled();
    expect(unlocked).toBe(false);
    expect(dapp.hasWindow(host)).toBe(true);
    expect(dapp.getAccount(host)?.address).toBe(address);
    const inject = jest.mocked(chrome.scripting.executeScript);
    expect(inject.mock.calls[0][0].args?.[0]).toEqual({
      id: PaliEvents.lockStateChanged,
      data: {
        method: PaliEvents.lockStateChanged,
        params: { isUnlocked: false, accounts: [], xpub: null },
      },
    });
    inject.mockClear();
    unlocked = true;
    await dapp.handleStateChange(PaliEvents.lockStateChanged, {
      method: PaliEvents.lockStateChanged,
      params: { isUnlocked: true },
    });
    await new Promise(setImmediate);
    expect(inject.mock.calls[0][0].args?.[0]).toEqual({
      id: PaliEvents.lockStateChanged,
      data: {
        method: PaliEvents.lockStateChanged,
        params: {
          isUnlocked: true,
          accounts: [address],
          xpub: 'public-old-xpub',
        },
      },
    });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: 'wallet_forgotten',
    });
  });

  it('does not carry a forgotten wallet permission into a new account in the same slot', async () => {
    const { host } = seedOldPermission();
    const dapp = DAppController(() => true);
    await wallet.forgetWallet('synthetic password');
    const afterForget = Object.keys(store.getState().dapp.dapps);
    // Use the same clean-vault/account reducers as createWalletExclusive.
    store.dispatch(
      initializeCleanVaultForSlip44({
        ...SYSCOIN_MAINNET_NETWORK,
        kind: 'ethereum',
        chainId: 1,
        url: 'https://new.synthetic.invalid',
        slip44: 60,
      } as any)
    );
    store.dispatch(
      createAccount({
        account: {
          id: 0,
          address: '0x2222222222222222222222222222222222222222',
          label: 'New synthetic wallet',
        } as any,
        accountType: KeyringAccountType.HDAccount,
      })
    );
    await persistMainStateStrict();
    expect({
      afterForget,
      newlyDisclosedAccount: dapp.getAccount(host)?.address,
      persistedOrigins: Object.keys(records.state.dapp.dapps),
    }).toEqual({
      afterForget: [],
      newlyDisclosedAccount: undefined,
      persistedOrigins: [],
    });
  });

  it('restores the old permission with the old wallet when a forget rolls back', async () => {
    const { host, address } = seedOldPermission();
    failRemoval = 'state-vault-60';
    const outcome = await wallet.forgetWallet('synthetic password').then(
      () => 'success',
      (error: any) => error.message || String(error)
    );
    expect(outcome).toBe('synthetic storage removal failure');
    expect(records).toEqual(originalRecords);
    expect(DAppController(() => true).getAccount(host)?.address).toBe(address);
    expect(Object.keys(store.getState().dapp.dapps)).toEqual([host]);
  });

  it('does not acknowledge a forget that leaves a reloadable inactive vault behind', async () => {
    failRemoval = 'state-vault-60';
    const result = await wallet.forgetWallet('synthetic password').then(
      () => ({ success: true }),
      (error: unknown) => ({ success: false, error })
    );
    expect(records).toEqual(originalRecords);
    expect(records['state-vault-60']).toEqual(oldEvmVault);

    // Exercise the real persisted-vault loader after the reset cleared caches.
    // This is not a claim that a new wallet already signed with the old key.
    await loadAndActivateSlip44Vault(60, SYSCOIN_MAINNET_NETWORK, true);
    expect(store.getState().vault.accounts.Imported[7].label).toBe(
      'Previous wallet imported account'
    );
    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        message: 'synthetic storage removal failure',
      }),
    });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: 'wallet_forgotten',
    });
    expect(walletPersistenceGate.blocked).toBe(false);
    expect(wallet.recoveryJournalPending).toBe(false);
    expect(unlocked).toBe(false);

    // Simulate the user unlocking the restored wallet and retrying.
    unlocked = true;
    failRemoval = undefined;
    await expect(
      wallet.forgetWallet('synthetic password')
    ).resolves.toBeUndefined();
    expect(records).toEqual({});
  });

  it('keeps records and the unlocked session unchanged for a wrong password', async () => {
    await expect(wallet.forgetWallet('wrong password')).rejects.toThrow(
      'Invalid password'
    );
    expect(records).toEqual(originalRecords);
    expect(unlocked).toBe(true);
    expect(wallet.walletStateGeneration).toBe(0);
    expect(wallet.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });

  it.each(['before', 'after', 'noop'] as const)(
    'does not delete wallet data when its backup write fails %s applying',
    async (fault) => {
      journalWriteFault = fault;
      await expect(
        wallet.forgetWallet('synthetic password')
      ).rejects.toBeDefined();
      expect(records).toEqual(originalRecords);
      expect(wallet.walletStateGeneration).toBe(0);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
        type: 'wallet_forgotten',
      });
      expect(walletPersistenceGate.blocked).toBe(false);
      expect(wallet.recoveryJournalPending).toBe(false);
    }
  );

  it('cancels removal when the authenticated session changes during its backup write', async () => {
    const write = jest
      .mocked(chrome.storage.local.set)
      .getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => (entered = resolve));
    jest
      .mocked(chrome.storage.local.set)
      .mockImplementation((items, callback) => {
        write(items, () => {
          if (JOURNAL in items) {
            release = callback!;
            entered();
          } else callback!();
        });
      });
    const removing = wallet.forgetWallet('synthetic password');
    const rejected = expect(removing).rejects.toThrow(
      'Wallet state changed before removal'
    );
    await writing;
    wallet.lock();
    release();
    await rejected;
    expect(records).toEqual(originalRecords);
    expect(wallet.walletStateGeneration).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: 'wallet_forgotten',
    });
  });

  it.each(['sysweb3-vault', 'sysweb3-vault-keys', 'state-vault-60'])(
    'restores the complete snapshot when %s deletion applies but loses its acknowledgement',
    async (key) => {
      failRemoval = key;
      removeAfterApply = true;
      await expect(
        wallet.forgetWallet('synthetic password')
      ).rejects.toMatchObject({
        message: 'synthetic storage removal failure',
      });
      expect(records).toEqual(originalRecords);
      expect(walletPersistenceGate.blocked).toBe(false);
      expect(wallet.recoveryJournalPending).toBe(false);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
        type: 'wallet_forgotten',
      });
    }
  );

  it.each(['sysweb3-vault', 'state-vault-60', JOURNAL])(
    'rejects a silent no-op removal of %s instead of acknowledging stale data',
    async (key) => {
      noOpRemoval = key;
      await expect(
        wallet.forgetWallet('synthetic password')
      ).rejects.toBeDefined();
      // A no-op journal cleanup also leaves the rollback backup for restart.
      for (const [record, value] of Object.entries(originalRecords))
        expect(records[record]).toEqual(value);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
        type: 'wallet_forgotten',
      });
    }
  );

  it('accepts a lost final cleanup acknowledgement only after proving the completed reset', async () => {
    failRemoval = JOURNAL;
    removeAfterApply = true;
    await expect(
      wallet.forgetWallet('synthetic password')
    ).resolves.toBeUndefined();
    expect(records).toEqual({});
    expect(walletPersistenceGate.blocked).toBe(false);
    expect(wallet.recoveryJournalPending).toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'wallet_forgotten',
    });
  });

  it('retains its backup and blocks persistence when rollback fails, then restores on cold startup', async () => {
    failRemoval = 'state-vault-60';
    failRestore = true;
    await expect(
      wallet.forgetWallet('synthetic password')
    ).rejects.toMatchObject({
      message: 'synthetic restore failure',
    });
    expect(records[JOURNAL].before).toEqual(originalRecords);
    expect(walletPersistenceGate.blocked).toBe(true);
    expect(wallet.recoveryJournalPending).toBe(true);
    expect(unlocked).toBe(false);
    await expect(wallet.getSeed('synthetic password')).rejects.toThrow(
      'Wallet setup is in progress'
    );
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: 'wallet_forgotten',
    });

    failRestore = false;
    failRemoval = undefined;
    vaultCache.clearCache();
    await expect(
      reconcileWalletRecoveryJournal(wallet.walletRecoveryContext())
    ).resolves.toBe(true);
    expect(records).toEqual(originalRecords);
    expect(walletPersistenceGate.blocked).toBe(false);
    expect(store.getState().vault.activeNetwork.slip44).toBe(57);
  });
});
