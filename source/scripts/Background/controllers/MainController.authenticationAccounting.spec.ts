import { webcrypto } from 'crypto';

import { getController } from '..';
import { AsyncMutex } from 'utils/asyncMutex';
import { clearNavigationState } from 'utils/navigationState';
import { chromeStorage } from 'utils/storageAPI';

import { createBrowserKeyringHost } from './browserKeyringHost';
import MainController from './MainController';

jest.unmock('syscoinjs-lib');
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
  createKeyringHost: jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/software.js'
  ).createKeyringHost,
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
jest.mock('./storageManager', () => ({
  StorageManager: {
    getInstance: () => ({ ensureInitialized: async () => undefined }),
  },
}));

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public authentication fixture password';
const RATE_KEY = 'pali_rate_limit_state';
const NOW = 1800000000000;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator'
);
const oldIterations = process.env.SYSWEB3_PBKDF2_ENC_ITERS;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, _options: unknown, work: () => unknown) =>
          work(),
      },
    },
  });
  // Exercise the released SDK's actual production work factor even in Jest.
  process.env.SYSWEB3_PBKDF2_ENC_ITERS = '900000';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  jest.mocked(clearNavigationState).mockClear();
  jest.mocked(getController).mockReturnValue({} as any);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
  if (originalNavigator)
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
  if (oldIterations === undefined) delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
  else process.env.SYSWEB3_PBKDF2_ENC_ITERS = oldIterations;
});

async function fixture() {
  const sdk = jest.requireActual('@sidhujag/sysweb3-keyring/cjs/software');
  const records: Record<string, any> = {};
  jest
    .spyOn(chrome.storage.local, 'get')
    .mockImplementation((async (keys: string[]) =>
      Object.fromEntries(
        keys.map((key) => [key, structuredClone(records[key])])
      )) as any);
  jest.spyOn(chrome.storage.local, 'set').mockImplementation((async (
    items: Record<string, unknown>
  ) => {
    Object.assign(records, structuredClone(items));
  }) as any);
  jest.spyOn(chrome.storage.local, 'remove').mockImplementation((async (
    key: string
  ) => {
    delete records[key];
  }) as any);
  const state = {
    activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
    activeNetwork: {
      kind: sdk.INetworkType.Ethereum,
      chainId: 1,
      slip44: 60,
      currency: 'ETH',
      label: 'Public fixture',
      url: 'https://example.invalid',
    },
    accounts: {
      HDAccount: {} as Record<number, unknown>,
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    },
  };
  const keyring = new sdk.SoftwareKeyring(
    createBrowserKeyringHost(chrome.storage.local, null),
    { captureEvmSubmission: null }
  );
  keyring.setVaultStateGetter(() => state);
  await keyring.initializeSession(PHRASE, PASSWORD);
  state.accounts.HDAccount[0] = await keyring.createFirstAccount();
  await keyring.lockWallet();
  const originalUnlock = keyring.unlock.bind(keyring);
  const sdkUnlock = jest
    .spyOn(keyring, 'unlock')
    .mockImplementation(originalUnlock);
  const sdkLock = jest.spyOn(keyring, 'lockWallet');
  let activeKeyring = keyring;
  jest
    .spyOn(chromeStorage, 'getItem')
    .mockImplementation(async (key: string) => structuredClone(records[key]));
  const writes = jest
    .spyOn(chromeStorage, 'setItem')
    .mockImplementation(async (key: string, value: unknown) => {
      records[key] = structuredClone(value);
    });
  const makeWallet = () => {
    const wallet: any = Object.create(MainController.prototype);
    Object.assign(wallet, {
      walletSessionGeneration: 0,
      walletStateGeneration: 0,
      authenticationMutex: new AsyncMutex(),
      failedUnlockAttempts: 0,
      lastFailedUnlockTime: 0,
      rateLimitInitialized: false,
      RATE_LIMIT_STORAGE_KEY: RATE_KEY,
      MAX_FAILED_ATTEMPTS: 10,
      LOCKOUT_DURATION: 5 * 60 * 1000,
      getActiveKeyring: () => activeKeyring,
      lockAllKeyrings: () => {
        void keyring.lockWallet();
      },
    });
    return wallet;
  };
  const wallet = makeWallet();
  const accountCreation = jest.spyOn(keyring, 'createFirstAccount');
  const reset = jest.spyOn(wallet, 'resetRateLimit');
  const failed = jest.spyOn(wallet, 'recordFailedAttempt');
  return {
    wallet,
    keyring,
    sdkUnlock,
    sdkLock,
    writes,
    records,
    reset,
    failed,
    accountCreation,
    makeWallet,
    cancel(networkSwitch = false, replaceWallet = false) {
      wallet.advanceWalletSession();
      if (replaceWallet) wallet.walletStateGeneration++;
      if (networkSwitch || replaceWallet)
        activeKeyring = { isUnlocked: () => false };
      void keyring.lockWallet();
    },
    hold(password: string) {
      const entered = deferred<void>();
      const release = deferred<void>();
      sdkUnlock.mockImplementationOnce(async () => {
        const pending = originalUnlock(password);
        entered.resolve();
        await release.promise;
        return pending;
      });
      return { entered: entered.promise, release: () => release.resolve() };
    },
  };
}

it('counts every cancelled real-SDK bad password once and persists the existing ten-attempt lockout', async () => {
  const f = await fixture();
  for (let attempt = 1; attempt <= 10; attempt++) {
    const hold = f.hold('wrong password');
    const pending = f.wallet.unlock('wrong password');
    const rejected = expect(pending).rejects.toThrow('Wallet session changed');
    await hold.entered;
    f.cancel();
    hold.release();
    await rejected;
    expect(f.records[RATE_KEY]).toEqual({
      failedAttempts: attempt,
      lastFailedTime: NOW,
    });
    expect(f.failed).toHaveBeenCalledTimes(attempt);
    expect(f.sdkLock).toHaveBeenCalledTimes(attempt);
    expect(f.reset).not.toHaveBeenCalled();
  }
  const restarted = f.makeWallet();
  await expect(restarted.unlock(PASSWORD)).rejects.toThrow(
    'Too many failed attempts'
  );
  expect(f.sdkUnlock).toHaveBeenCalledTimes(10);
  expect(f.keyring.isUnlocked()).toBe(false);
  expect(f.accountCreation).not.toHaveBeenCalled();
});

it('counts cancellation by a network keyring switch while preserving wallet ownership', async () => {
  const f = await fixture();
  const hold = f.hold('wrong password');
  const pending = f.wallet.unlock('wrong password');
  const rejected = expect(pending).rejects.toThrow('Wallet session changed');
  await hold.entered;
  f.cancel(true);
  hold.release();
  await rejected;
  expect(f.records[RATE_KEY]).toEqual({
    failedAttempts: 1,
    lastFailedTime: NOW,
  });
  expect(f.failed).toHaveBeenCalledTimes(1);
});

it('does not charge a reset or replaced wallet for an old SDK rejection', async () => {
  const f = await fixture();
  const hold = f.hold('wrong password');
  const pending = f.wallet.unlock('wrong password');
  const rejected = expect(pending).rejects.toThrow('Wallet session changed');
  await hold.entered;
  f.cancel(false, true);
  hold.release();
  await rejected;
  expect(f.records[RATE_KEY]).toBeUndefined();
  expect(f.failed).not.toHaveBeenCalled();
  expect(f.reset).not.toHaveBeenCalled();
});

it('a cancelled successful SDK unlock neither resets the old counter nor exposes a session', async () => {
  const f = await fixture();
  await expect(f.wallet.unlock('wrong password')).resolves.toEqual({
    canLogin: false,
  });
  const hold = f.hold(PASSWORD);
  const pending = f.wallet.unlock(PASSWORD);
  const rejected = expect(pending).rejects.toThrow('Wallet session changed');
  await hold.entered;
  f.cancel();
  hold.release();
  await rejected;
  expect(f.records[RATE_KEY]).toEqual({
    failedAttempts: 1,
    lastFailedTime: NOW,
  });
  expect(f.reset).not.toHaveBeenCalled();
  expect(f.accountCreation).not.toHaveBeenCalled();
  expect(clearNavigationState).not.toHaveBeenCalled();
  expect(f.keyring.isUnlocked()).toBe(false);
});

it('rechecks cancellation between the SDK helper and public success handling before resetting failures', async () => {
  const f = await fixture();
  await f.wallet.unlock('wrong password');
  const unlock = f.wallet.unlockKeyring.bind(f.wallet);
  jest
    .spyOn(f.wallet, 'unlockKeyring')
    .mockImplementation(async (...args: unknown[]) => {
      const result = await unlock(...args);
      f.cancel();
      return result;
    });
  await expect(f.wallet.unlock(PASSWORD)).rejects.toThrow(
    'Wallet session changed'
  );
  expect(f.records[RATE_KEY]).toEqual({
    failedAttempts: 1,
    lastFailedTime: NOW,
  });
  expect(f.reset).not.toHaveBeenCalled();
});

it.each([
  null,
  {},
  { canLogin: undefined },
  { canLogin: 0 },
  { canLogin: 'false' },
  { canLogin: true, needsAccountCreation: 'yes' },
  { canLogin: false, needsAccountCreation: 'no' },
])(
  'does not count malformed SDK result %j as an authentication rejection',
  async (result) => {
    const f = await fixture();
    f.sdkUnlock.mockResolvedValueOnce(result);
    await expect(f.wallet.unlock(PASSWORD)).rejects.toThrow();
    expect(f.failed).not.toHaveBeenCalled();
    expect(f.reset).not.toHaveBeenCalled();
    expect(f.records[RATE_KEY]).toBeUndefined();
  }
);

it('does not count thrown operational errors even when their text says Invalid password', async () => {
  const f = await fixture();
  const error = new Error('Invalid password');
  f.sdkUnlock.mockRejectedValueOnce(error);
  await expect(f.wallet.unlock(PASSWORD)).rejects.toBe(error);
  expect(f.failed).not.toHaveBeenCalled();
  expect(f.records[RATE_KEY]).toBeUndefined();
});

it('normal public login and note reauthentication each count an explicit false only once', async () => {
  const f = await fixture();
  await expect(f.wallet.unlockFromController('wrong password')).rejects.toThrow(
    'Invalid password'
  );
  expect(f.failed).toHaveBeenCalledTimes(1);
  await f.keyring.unlock(PASSWORD);
  const reveal = jest.fn(async () => 'not returned');
  await expect(
    f.wallet.authenticatePrivateVault(
      'wrong password',
      f.wallet.capturePrivateVaultSession(),
      reveal
    )
  ).rejects.toThrow('Invalid password');
  expect(f.failed).toHaveBeenCalledTimes(2);
  expect(reveal).not.toHaveBeenCalled();
  expect(f.records[RATE_KEY]).toEqual({
    failedAttempts: 2,
    lastFailedTime: NOW,
  });
});

it.each(['getSeed', 'getPrivateKeyByAccountId'] as const)(
  '%s keeps its existing single-count error path and skips a replaced wallet',
  async (method) => {
    for (const replaced of [false, true]) {
      const f = await fixture();
      await f.keyring.unlock(PASSWORD);
      const original = f.keyring[method].bind(f.keyring);
      const entered = deferred<void>();
      const release = deferred<void>();
      jest
        .spyOn(f.keyring, method)
        .mockImplementation(async (...args: unknown[]) => {
          try {
            return await original(...args);
          } catch (error) {
            entered.resolve();
            await release.promise;
            throw error;
          }
        });
      const pending =
        method === 'getSeed'
          ? f.wallet.getSeed('wrong password')
          : f.wallet.getPrivateKeyByAccountId(0, 'HDAccount', 'wrong password');
      const rejected = expect(pending).rejects.toThrow('Invalid password');
      await entered.promise;
      f.cancel(false, replaced);
      release.resolve();
      await rejected;
      expect(f.failed).toHaveBeenCalledTimes(replaced ? 0 : 1);
      expect(f.records[RATE_KEY]).toEqual(
        replaced ? undefined : { failedAttempts: 1, lastFailedTime: NOW }
      );
    }
  }
);
