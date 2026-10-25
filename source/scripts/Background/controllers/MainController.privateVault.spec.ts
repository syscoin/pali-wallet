jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('utils/slhDsa', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
  clearSLHDSAPublicPrecomputeCache: jest.fn().mockResolvedValue(undefined),
  clearSLHDSAXmssTreeCache: jest.fn().mockResolvedValue(undefined),
}));

import { webcrypto } from 'crypto';

import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { AsyncMutex, walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';
import { forgetWalletWithRecovery } from './walletRecovery';

const originalChrome = global.chrome;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const PROFILE_KEY = `state-private-vault-v1:0x${'ab'.repeat(32)}`;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  const keyring = {
    isUnlocked: jest.fn(() => true),
    unlock: jest.fn(async () => ({ canLogin: true })),
    lockWallet: jest.fn(async () => undefined),
  };
  const wallet: any = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    authenticationMutex: new AsyncMutex(),
    getActiveKeyring: () => keyring,
    prepareWalletRecoveryAccess: jest.fn(async () => undefined),
    checkRateLimit: jest.fn(async () => 0),
    resetRateLimit: jest.fn(async () => undefined),
    recordFailedAttempt: jest.fn(async () => undefined),
  });
  return { wallet, keyring };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  walletPersistenceGate.blocked = false;
});
afterEach(() => {
  global.chrome = originalChrome;
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  walletPersistenceGate.blocked = false;
  jest.restoreAllMocks();
});

it('authenticates reveal through the existing password rate limit without exporting the seed', async () => {
  const { wallet, keyring } = fixture();
  const reveal = jest.fn(async () => 'synthetic-private-note');
  await expect(
    wallet.authenticatePrivateVault(
      'password',
      wallet.capturePrivateVaultSession(),
      reveal
    )
  ).resolves.toBe('synthetic-private-note');
  expect(keyring.unlock).toHaveBeenCalledWith('password');
  expect(wallet.checkRateLimit).toHaveBeenCalledTimes(1);
  expect(wallet.resetRateLimit).toHaveBeenCalledTimes(1);
  expect(reveal).toHaveBeenCalledTimes(1);
});

it('counts one incorrect password and releases no note', async () => {
  const { wallet, keyring } = fixture();
  keyring.unlock.mockResolvedValueOnce({ canLogin: false });
  const reveal = jest.fn(async () => 'synthetic-private-note');
  await expect(
    wallet.authenticatePrivateVault(
      'wrong',
      wallet.capturePrivateVaultSession(),
      reveal
    )
  ).rejects.toThrow('Invalid password');
  expect(wallet.recordFailedAttempt).toHaveBeenCalledTimes(1);
  expect(reveal).not.toHaveBeenCalled();
});

it('enforces an existing password lockout before invoking the keyring or reading ciphertext', async () => {
  const { wallet, keyring } = fixture();
  wallet.checkRateLimit.mockResolvedValueOnce(42);
  const reveal = jest.fn();
  await expect(
    wallet.authenticatePrivateVault(
      'wrong',
      wallet.capturePrivateVaultSession(),
      reveal
    )
  ).rejects.toThrow(
    'Too many failed attempts. Please wait 42 seconds before trying again.'
  );
  expect(keyring.unlock).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
});

it('rejects reveal if the wallet locks during password verification', async () => {
  const { wallet, keyring } = fixture();
  const entered = deferred();
  const release = deferred();
  keyring.unlock.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { canLogin: true };
  });
  const reveal = jest.fn();
  const result = wallet.authenticatePrivateVault(
    'password',
    wallet.capturePrivateVaultSession(),
    reveal
  );
  const failure = expect(result).rejects.toThrow('Wallet session changed');
  await entered.promise;
  wallet.walletSessionGeneration++;
  release.resolve();
  await failure;
  expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
  expect(reveal).not.toHaveBeenCalled();
});

it('rejects plaintext produced after a session change in a reveal callback', async () => {
  const { wallet } = fixture();
  await expect(
    wallet.authenticatePrivateVault(
      'password',
      wallet.capturePrivateVaultSession(),
      async () => {
        wallet.walletSessionGeneration++;
        return 'synthetic-private-note';
      }
    )
  ).rejects.toThrow('privacy_vault_session_changed');
});

it('serializes reveal and reset in authentication then persistence order', async () => {
  const { wallet } = fixture();
  const entered = deferred();
  const release = deferred();
  const events: string[] = [];
  const revealing = wallet.authenticatePrivateVault(
    'password',
    wallet.capturePrivateVaultSession(),
    () =>
      walletPersistenceMutex.runExclusive(async () => {
        events.push('reveal');
        entered.resolve();
        await release.promise;
        return 'synthetic-private-note';
      })
  );
  await entered.promise;
  wallet.forgetWalletExclusive = jest.fn(() =>
    walletPersistenceMutex.runExclusive(async () => {
      events.push('reset');
      wallet.walletSessionGeneration++;
    })
  );
  const reset = wallet.forgetWallet('password');
  expect(events).toEqual(['reveal']);
  release.resolve();
  await revealing;
  await reset;
  expect(events).toEqual(['reveal', 'reset']);
});

it('does not load the custody chunk while locked or restoring wallet state', async () => {
  const { wallet, keyring } = fixture();
  const load = jest.spyOn(wallet, 'getPrivateVaultController');
  keyring.isUnlocked.mockReturnValue(false);
  await expect(wallet.getPrivateVaultNotes()).rejects.toThrow(
    'privacy_vault_locked'
  );
  keyring.isUnlocked.mockReturnValue(true);
  wallet.recoveryJournalPending = true;
  await expect(
    wallet.importPrivateVaultNote('synthetic-private-note')
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(load).not.toHaveBeenCalled();
});

it('does not transfer an admitted request across a delayed chunk load', async () => {
  const { wallet } = fixture();
  const release = deferred();
  const getNotes = jest.fn(async () => ({ notes: [] }));
  wallet.privateVaultController = release.promise.then(() => ({ getNotes }));
  const result = wallet.getPrivateVaultNotes();
  const failure = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  wallet.walletSessionGeneration++;
  release.resolve();
  await failure;
  expect(getNotes).not.toHaveBeenCalled();
});

it('checks the session again after controller responses', async () => {
  const { wallet } = fixture();
  wallet.privateVaultController = Promise.resolve({
    revealNote: async () => {
      wallet.walletSessionGeneration++;
      return 'synthetic-private-note';
    },
  });
  await expect(wallet.revealPrivateVaultNote('id', 'password')).rejects.toThrow(
    'privacy_vault_session_changed'
  );
});

it.each([false, true])(
  'uses existing forget-wallet journaling for ciphertext (reset failure: %s)',
  async (fail) => {
    const { wallet } = fixture();
    const vault = structuredClone(store.getState().vault);
    const records: Record<string, any> = {
      'sysweb3-vault': 'synthetic-root-ciphertext',
      'sysweb3-vault-keys': { salt: 'synthetic-salt' },
      state: { vaultGlobal: { activeSlip44: 57 } },
      'state-vault-57': vault,
      [PROFILE_KEY]: { ciphertext: 'opaque encrypted manifest' },
    };
    const original = structuredClone(records);
    global.chrome = {
      ...originalChrome,
      runtime: {},
      storage: {
        local: {
          get: (keys: any, callback: any) => {
            const list =
              keys === null
                ? Object.keys(records)
                : typeof keys === 'string'
                ? [keys]
                : keys;
            callback(
              Object.fromEntries(
                list
                  .filter((key: string) => key in records)
                  .map((key: string) => [key, structuredClone(records[key])])
              )
            );
          },
          set: (values: any, callback: any) => {
            Object.assign(records, structuredClone(values));
            callback();
          },
          remove: (keys: any, callback: any) => {
            (Array.isArray(keys) ? keys : [keys]).forEach(
              (key: string) => delete records[key]
            );
            callback();
          },
        },
      },
    } as any;
    wallet.resetWalletState = async () => {
      wallet.walletSessionGeneration++;
      wallet.walletStateGeneration++;
      await walletPersistenceMutex.runExclusive(async () => {
        delete records[PROFILE_KEY];
        if (fail) throw new Error('synthetic reset failure');
        for (const key of Object.keys(records))
          if (key.startsWith('state') || key.startsWith('sysweb3-vault'))
            delete records[key];
      });
    };
    wallet.lock = () => {
      wallet.walletSessionGeneration++;
    };
    const rehydrate = jest.fn(async () => undefined);
    const context = {
      getState: () => store.getState(),
      persistenceMutex: walletPersistenceMutex,
      readPresence: async () => true,
      storage: chromeStorage,
      rehydrate,
    };
    if (fail) {
      await expect(forgetWalletWithRecovery(wallet, context)).rejects.toThrow(
        'synthetic reset failure'
      );
      expect(records).toEqual(original);
      expect(rehydrate).toHaveBeenCalledTimes(1);
    } else {
      await expect(
        forgetWalletWithRecovery(wallet, context)
      ).resolves.toBeUndefined();
      expect(records).toEqual({});
    }
    expect(wallet.recoveryJournalPending).toBe(false);
  }
);
